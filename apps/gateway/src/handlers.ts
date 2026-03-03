/**
 * Gateway RPC 实现：health、cron.*、connect、agents、sessions、sessions.patch、agent、agent.wait、chat.history、chat.send、chat.abort、skills.status、node.*
 */

import os from "node:os";
import path from "node:path";
import type { CronJobCreate, CronJobPatch } from "@monou/cron";
import { CronStore, getDefaultStorePath } from "@monou/cron";
import type { ConnectIdentity, ErrorShape, GatewayResponse } from "@monou/gateway";
import type { ConnectionEntry, ConnectorMapping, GatewayContext } from "./context.js";
import {
	DEFAULT_LOCAL_AGENT_ID,
	getAgentsFromConnections,
	getConnectorsFromConnections,
	getFirstAgentId,
	getNodesFromConnections,
} from "./context.js";
import { clearActiveRunByRunId, enqueue, isSessionActive, onRunComplete, setActiveRun } from "./queue.js";
import {
	replaceAttachmentPlaceholderWithPendingUrl,
	saveBase64ToScreenshotFile,
	saveScreenshotsInContent,
} from "./screenshots.js";
import { getSessionResetPolicy, parseResetTrigger } from "./session-reset.js";
import {
	getTranscriptPathForSessionKey,
	loadSessionStore,
	removeSession,
	resolveSession,
	updateSessionEntry,
	updateSessionStoreSync,
} from "./session-store.js";
import type { StoredMessage } from "./session-transcript.js";
import {
	appendTranscriptMessages,
	getLastMessageIdInTranscript,
	initTranscript,
	loadTranscript,
	loadTranscriptTree,
} from "./session-transcript.js";
import type { SessionEntry } from "./session-types.js";

const INVALID_REQUEST = 400;
const NOT_FOUND = 404;

function err(code: number, message: string): ErrorShape {
	return { code, message };
}

function ok<T>(payload: T, meta?: Record<string, unknown>): GatewayResponse {
	return { ok: true, payload, ...(meta && { meta }) };
}

function fail(error: ErrorShape): GatewayResponse {
	return { ok: false, error };
}

/** 远程 agent 返回的 turnMessages 与 StoredMessage 兼容的 wire 条目 */
type TurnMessageWire = {
	role: "user" | "assistant" | "system" | "toolResult";
	content?: string;
	toolCalls?: Array<{ id: string; name: string; arguments?: string }>;
	toolCallId?: string;
	isError?: boolean;
};

/**
 * 根据远程 agent 的返回结果构建要写入 transcript 的消息链。
 * 若有 turnMessages（含 assistant 的 tool_calls、tool_result、最终 assistant），则整链写入，恢复会话时模型能看到完整上下文，避免重复回复。
 */
function buildToAppendFromRemoteResult(
	out: {
		text: string;
		turnMessages?: TurnMessageWire[];
	},
	userMessage: string,
	resolvedKey: string,
	screenshotsDir: string,
	senderAgentId?: string,
): StoredMessage[] {
	const assistantContent = replaceAttachmentPlaceholderWithPendingUrl(
		saveScreenshotsInContent(out.text, resolvedKey, screenshotsDir),
		screenshotsDir,
	);
	if (Array.isArray(out.turnMessages) && out.turnMessages.length > 0) {
		const lastIdx = out.turnMessages.length - 1;
		const mapped = out.turnMessages.map((m, i) => {
			const base: StoredMessage = {
				role: m.role as StoredMessage["role"],
				content: m.content,
				...(m.toolCalls && { toolCalls: m.toolCalls }),
				...(m.toolCallId !== undefined && { toolCallId: m.toolCallId }),
				...(m.isError !== undefined && { isError: m.isError }),
			};
			if (m.role === "assistant" && i === lastIdx) {
				return { ...base, content: assistantContent, ...(senderAgentId && { senderAgentId }) };
			}
			if (m.role === "assistant" && senderAgentId) {
				return { ...base, senderAgentId };
			}
			return base;
		});
		// 去重：连续两条 assistant 且 content 一致（trim 后）且无 toolCalls 时只保留一条，避免重复落盘
		let prev: StoredMessage | null = null;
		const norm = (s: string | undefined) => (s ?? "").trim();
		return mapped.filter((cur) => {
			if (
				prev?.role === "assistant" &&
				cur.role === "assistant" &&
				!prev.toolCalls?.length &&
				!(cur.toolCalls?.length) &&
				norm(prev.content) === norm(cur.content)
			) {
				return false;
			}
			prev = cur;
			return true;
		});
	}
	return [
		{ role: "user", content: userMessage },
		{ role: "assistant", content: assistantContent, ...(senderAgentId && { senderAgentId }) },
	];
}

/**
 * 追加一条 user 消息：若 transcript 当前叶节点已是同内容 user 则跳过；若路径末尾已是「同内容 user -> assistant」也跳过，避免同一句招呼被 invoke 两次。
 * 当 parentLeafId 为 null 时用文件中最后一条 message 的 id 作为有效叶节点。
 * 返回 { leafId, appended }；appended 为 false 时调用方不应再 invoke agent。
 */
function appendUserOnceIfNotDuplicate(
	transcriptPath: string,
	parentLeafId: string | null,
	userContent: string,
): { leafId: string; appended: boolean } {
	const realLeafId = parentLeafId ?? getLastMessageIdInTranscript(transcriptPath) ?? null;
	const current = loadTranscript(transcriptPath, realLeafId ?? undefined);
	const last = current[current.length - 1];
	const prev = current.length >= 2 ? current[current.length - 2] : undefined;
	const trimmed = (userContent ?? "").trim();
	if (last?.role === "user" && (last.content ?? "").trim() === trimmed) {
		return { leafId: realLeafId ?? "", appended: false };
	}
	// 路径末尾已是「同内容 user -> assistant」时不再追加，避免重复 invoke（招呼被发两次时只回复一次）
	if (
		last?.role === "assistant" &&
		prev?.role === "user" &&
		(prev.content ?? "").trim() === trimmed
	) {
		return { leafId: realLeafId ?? "", appended: false };
	}
	// 并发防护：若当前是「从根追加」，追加前再读一次叶节点，避免两请求同时看到空 transcript 各写一条 user
	let appendTo = realLeafId;
	if (appendTo === null) {
		const again = getLastMessageIdInTranscript(transcriptPath);
		if (again != null) {
			const recheck = loadTranscript(transcriptPath, again);
			const recheckLast = recheck[recheck.length - 1];
			if (recheckLast?.role === "user" && (recheckLast.content ?? "").trim() === trimmed) {
				return { leafId: again, appended: false };
			}
			appendTo = again;
		}
	}
	const newLeafId = appendTranscriptMessages(transcriptPath, appendTo, [
		{ role: "user" as const, content: userContent },
	]);
	return { leafId: newLeafId, appended: true };
}

/**
 * 若 toAppend 首条为 user 且 transcript 当前路径中已有同内容 user（可能 progress 已写过 assistant），则去掉首条，避免重复。
 */
function stripLeadingUserIfInTranscript(
	transcriptPath: string,
	parentLeafId: string | null,
	toAppend: StoredMessage[],
): StoredMessage[] {
	if (toAppend.length === 0 || toAppend[0]?.role !== "user") return toAppend;
	const current = loadTranscript(
		transcriptPath,
		parentLeafId ?? getLastMessageIdInTranscript(transcriptPath) ?? undefined,
	);
	const trimmed = (toAppend[0].content ?? "").trim();
	const alreadyHas = current.some(
		(m) => m.role === "user" && (m.content ?? "").trim() === trimmed,
	);
	return alreadyHas ? toAppend.slice(1) : toAppend;
}

/** 将 turnMessages 转为 StoredMessage[]；可选替换最后一条 assistant 的 content（用于 result 时写最终回复） */
function turnMessagesToStored(
	turnMessages: TurnMessageWire[],
	opts?: { lastAssistantContent?: string; senderAgentId?: string },
): StoredMessage[] {
	if (!Array.isArray(turnMessages) || turnMessages.length === 0) return [];
	const lastIdx = turnMessages.length - 1;
	const { lastAssistantContent, senderAgentId } = opts ?? {};
	return turnMessages.map((m, i) => {
		const base: StoredMessage = {
			role: m.role as StoredMessage["role"],
			content: m.content,
			...(m.toolCalls && { toolCalls: m.toolCalls }),
			...(m.toolCallId !== undefined && { toolCallId: m.toolCallId }),
			...(m.isError !== undefined && { isError: m.isError }),
		};
		if (m.role === "assistant" && i === lastIdx && lastAssistantContent !== undefined) {
			return { ...base, content: lastAssistantContent, ...(senderAgentId && { senderAgentId }) };
		}
		if (m.role === "assistant" && senderAgentId) return { ...base, senderAgentId };
		return base;
	});
}

/** 群聊：从 message 解析 @agentId，或返回 leadAgentId / 第一个 participant */
function resolveGroupAgentId(entry: SessionEntry, message: string): string {
	const participants = entry.participantAgentIds ?? [];
	const lead = entry.leadAgentId ?? participants[0];
	const match = message.match(/@([a-zA-Z0-9._-]+)/);
	if (match) {
		const id = match[1]!.trim();
		if (participants.includes(id)) return id;
	}
	return lead ?? participants[0] ?? "";
}

/** 按 agentId 解析该 Agent 的 cron store 路径（.u 用默认，其他用 agents/<id>/cron/jobs.json） */
function getCronStoreForAgent(rootDir: string, agentId: string): CronStore {
	const storePath =
		agentId === DEFAULT_LOCAL_AGENT_ID
			? getDefaultStorePath(rootDir)
			: path.join(rootDir, "agents", agentId, "cron", "jobs.json");
	return new CronStore(storePath);
}

export type RequestContext = { connId: string; entry: ConnectionEntry };

export type HandlersContext = GatewayContext;

/** 当前进行中的 agent invoke：发请求时先写 user、记 leafId，progress 时追写、result 时只追写剩余 */
type InvokeSessionInfo = {
	sessionKey: string;
	transcriptPath: string;
	leafId: string;
	sessionStorePath: string;
	resolvedKey: string;
	appendedTurnCount: number;
};

export function createHandlers(ctx: HandlersContext) {
	const {
		cronStore,
		rootDir,
		connections,
		pendingInvokes,
		pendingFileUploads,
		nextInvokeId,
		nextRunId,
		inFlightAgentRuns,
		runIdToPromise,
		runIdToAbort,
		connectorMappings,
		nextMappingId,
		persistConnectorMappings,
		sessionStorePath,
		mainTranscriptPath,
	} = ctx;
	const resetPolicy = getSessionResetPolicy();
	const invokeIdToSession = new Map<string, InvokeSessionInfo>();

	return {
		connect: async (params: Record<string, unknown>): Promise<GatewayResponse> => {
			const identity = params as unknown as ConnectIdentity;
			return ok({ ok: true, message: "connected", identity: identity?.role ? identity : undefined });
		},

		health: async (): Promise<GatewayResponse> => {
			const status = await cronStore.status();
			return ok({
				ok: true,
				ts: Date.now(),
				startedAt: ctx.startedAt,
				cron: { storePath: status.storePath, jobs: status.jobs, nextWakeAtMs: status.nextWakeAtMs },
			});
		},

		status: async (): Promise<GatewayResponse> => {
			const status = await cronStore.status();
			const agents = getAgentsFromConnections(connections);
			const nodes = getNodesFromConnections(connections);
			return ok({
				ok: true,
				ts: Date.now(),
				cron: status,
				agents: agents.length,
				nodes: nodes.length,
			});
		},

		"cron.list": async (params: Record<string, unknown>): Promise<GatewayResponse> => {
			const agentId = (params?.agentId as string)?.trim() || (getFirstAgentId(connections) ?? "");
			if (!agentId) return ok({ jobs: [] });
			const includeDisabled = params?.includeDisabled === true;
			const store = getCronStoreForAgent(rootDir, agentId);
			const jobs = await store.list({ includeDisabled });
			return ok({ jobs });
		},

		"cron.status": async (params: Record<string, unknown>): Promise<GatewayResponse> => {
			const agentId = (params?.agentId as string)?.trim() || (getFirstAgentId(connections) ?? "");
			if (!agentId) return ok({ storePath: "", jobs: [], nextWakeAtMs: undefined });
			const store = getCronStoreForAgent(rootDir, agentId);
			const status = await store.status();
			return ok({
				schedulerRunning: false,
				storePath: status.storePath,
				jobs: status.jobs,
				nextWakeAtMs: status.nextWakeAtMs,
			});
		},

		"cron.add": async (params: Record<string, unknown>): Promise<GatewayResponse> => {
			if (!params || typeof params !== "object") return fail(err(INVALID_REQUEST, "cron.add requires params"));
			const agentId = (params?.agentId as string)?.trim() || (getFirstAgentId(connections) ?? "");
			if (!agentId)
				return fail(err(INVALID_REQUEST, "cron.add requires params.agentId or at least one connected agent"));
			const store = getCronStoreForAgent(rootDir, agentId);
			const { agentId: _a, ...createParams } = params;
			try {
				const job = await store.add(createParams as unknown as CronJobCreate);
				return ok(job);
			} catch (e) {
				return fail(err(INVALID_REQUEST, (e as Error).message));
			}
		},

		"cron.update": async (params: Record<string, unknown>): Promise<GatewayResponse> => {
			const id = params?.id;
			if (typeof id !== "string") return fail(err(INVALID_REQUEST, "cron.update requires params.id"));
			const agentId = (params?.agentId as string)?.trim() || (getFirstAgentId(connections) ?? "");
			if (!agentId)
				return fail(err(INVALID_REQUEST, "cron.update requires params.agentId or at least one connected agent"));
			const store = getCronStoreForAgent(rootDir, agentId);
			const patch = { ...params, id: undefined, agentId: undefined } as CronJobPatch;
			try {
				const job = await store.update(id, patch);
				return ok(job);
			} catch (e) {
				return fail(
					err((e as Error).message.includes("unknown") ? NOT_FOUND : INVALID_REQUEST, (e as Error).message),
				);
			}
		},

		"cron.remove": async (params: Record<string, unknown>): Promise<GatewayResponse> => {
			const id = params?.id;
			if (typeof id !== "string") return fail(err(INVALID_REQUEST, "cron.remove requires params.id"));
			const agentId = (params?.agentId as string)?.trim() || (getFirstAgentId(connections) ?? "");
			if (!agentId)
				return fail(err(INVALID_REQUEST, "cron.remove requires params.agentId or at least one connected agent"));
			const store = getCronStoreForAgent(rootDir, agentId);
			const result = await store.remove(id);
			return ok(result);
		},

		"cron.run": async (params: Record<string, unknown>): Promise<GatewayResponse> => {
			const id = params?.id;
			if (typeof id !== "string") return fail(err(INVALID_REQUEST, "cron.run requires params.id"));
			const agentId = (params?.agentId as string)?.trim() || (getFirstAgentId(connections) ?? "");
			if (!agentId)
				return fail(err(INVALID_REQUEST, "cron.run requires params.agentId or at least one connected agent"));
			const store = getCronStoreForAgent(rootDir, agentId);
			const mode = params?.mode === "due" ? "due" : "force";
			const result = await store.run(id, mode);
			return ok(result);
		},

		"cron.runs": async (): Promise<GatewayResponse> => ok({ runs: [] }),

		"agents.list": async (): Promise<GatewayResponse> => {
			const agents = getAgentsFromConnections(connections);
			return ok({ agents });
		},

		/** Agent 执行完心跳任务后调用，用于更新 lastHeartbeatAt（agents.list 返回），供 UI 显示「最近活跃」 */
		"agent.heartbeat": async (_params: Record<string, unknown>, req?: RequestContext): Promise<GatewayResponse> => {
			const entry = req?.entry;
			if (entry?.identity?.role === "agent") {
				entry.lastHeartbeatAt = Date.now();
			}
			return ok({ ok: true });
		},

		"sessions.list": async (): Promise<GatewayResponse> => {
			const store = loadSessionStore(sessionStorePath, { skipCache: true });
			const sessions = Object.entries(store).map(([key, entry]) => ({
				key,
				sessionId: entry.sessionId,
				updatedAt: entry.updatedAt,
				displayName: entry.displayName,
				channel: entry.channel,
				contextTokens: entry.contextTokens,
				totalTokens: entry.totalTokens,
				model: entry.model,
				thinkingLevel: entry.thinkingLevel,
				sendPolicy: entry.sendPolicy,
				leafId: entry.leafId ?? null,
				...(entry.sessionType && { sessionType: entry.sessionType }),
				...(entry.participantAgentIds && { participantAgentIds: entry.participantAgentIds }),
				...(entry.leadAgentId && { leadAgentId: entry.leadAgentId }),
			}));
			const defaultAgentId = getFirstAgentId(connections) ?? undefined;
			return ok({ sessions, ...(defaultAgentId != null && { defaultAgentId }) });
		},

		"sessions.preview": async (): Promise<GatewayResponse> => {
			const store = loadSessionStore(sessionStorePath, { skipCache: true });
			const sessions = Object.entries(store).map(([key, entry]) => ({
				key,
				sessionId: entry.sessionId,
				updatedAt: entry.updatedAt,
				displayName: entry.displayName,
				leafId: entry.leafId ?? null,
				...(entry.sessionType && { sessionType: entry.sessionType }),
				...(entry.participantAgentIds && { participantAgentIds: entry.participantAgentIds }),
				...(entry.leadAgentId && { leadAgentId: entry.leadAgentId }),
			}));
			return ok({ sessions });
		},

		"sessions.patch": async (params: Record<string, unknown>): Promise<GatewayResponse> => {
			const sessionKey = (params?.sessionKey as string)?.trim();
			const sessionId = (params?.sessionId as string)?.trim();
			const patch = params?.patch as Partial<SessionEntry> | undefined;
			if (!patch || typeof patch !== "object") {
				return fail(err(INVALID_REQUEST, "sessions.patch requires params.patch (object)"));
			}
			const allowedKeys = new Set([
				"displayName",
				"channel",
				"sendPolicy",
				"thinkingLevel",
				"contextTokens",
				"totalTokens",
				"model",
				"leafId",
				"agentIdOverride",
				"sessionType",
				"participantAgentIds",
				"leadAgentId",
			]);
			const filtered: Partial<SessionEntry> = {};
			for (const [k, v] of Object.entries(patch)) {
				if (!allowedKeys.has(k) || v === undefined) continue;
				if (k === "participantAgentIds" && !Array.isArray(v)) continue;
				if (k === "sessionType" && v !== "single" && v !== "group") continue;
				(filtered as Record<string, unknown>)[k] = v;
			}
			if (Object.keys(filtered).length === 0) {
				return fail(err(INVALID_REQUEST, "sessions.patch: no allowed fields in patch"));
			}
			const canCreateGroup =
				typeof sessionKey === "string" &&
				sessionKey.length > 0 &&
				filtered.sessionType === "group" &&
				Array.isArray(filtered.participantAgentIds) &&
				filtered.participantAgentIds.length >= 1;

			const updated = updateSessionStoreSync(sessionStorePath, (store) => {
				let key: string | undefined;
				if (sessionKey && store[sessionKey]) key = sessionKey;
				else if (sessionId) {
					const found = Object.entries(store).find(([, e]) => e.sessionId === sessionId);
					if (found) key = found[0];
				}

				// 新建群聊：sessionKey 存在且 patch 含 sessionType=group + participantAgentIds 时，无则创建、有则更新
				if (canCreateGroup && sessionKey) {
					const existing = store[sessionKey];
					const now = Date.now();
					if (!existing) {
						const newSessionId = `s-${now}-${Math.random().toString(36).slice(2, 10)}`;
						const transcriptPathForNew = getTranscriptPathForSessionKey(sessionStorePath, sessionKey);
						const lead = (filtered.leadAgentId as string) ?? (filtered.participantAgentIds as string[])[0] ?? "";
						const newEntry: SessionEntry = {
							sessionId: newSessionId,
							updatedAt: now,
							transcriptPath: transcriptPathForNew,
							displayName: (filtered.displayName as string) || "群聊",
							channel: "webchat",
							leafId: null,
							sessionType: "group",
							participantAgentIds: filtered.participantAgentIds,
							leadAgentId: lead,
						};
						store[sessionKey] = newEntry;
						initTranscript(transcriptPathForNew, newSessionId);
						return newEntry;
					}
					store[sessionKey] = {
						...existing,
						...filtered,
						sessionId: existing.sessionId,
						updatedAt: now,
					};
					return store[sessionKey]!;
				}

				if (!key) return null;
				const entry = store[key]!;
				const now = Date.now();
				store[key] = { ...entry, ...filtered, sessionId: entry.sessionId, updatedAt: now };
				return store[key]!;
			});
			if (updated == null) return fail(err(NOT_FOUND, "session not found"));
			return ok(updated);
		},

		"sessions.delete": async (params: Record<string, unknown>): Promise<GatewayResponse> => {
			const sessionKey = (params?.sessionKey as string)?.trim();
			const sessionId = (params?.sessionId as string)?.trim();
			if (!sessionKey && !sessionId) {
				return fail(err(INVALID_REQUEST, "sessions.delete requires params.sessionKey or params.sessionId"));
			}
			const store = loadSessionStore(sessionStorePath, { skipCache: true });
			let key: string | undefined;
			if (sessionKey && store[sessionKey]) key = sessionKey;
			else if (sessionId) {
				const found = Object.entries(store).find(([, e]) => e.sessionId === sessionId);
				if (found) key = found[0];
			}
			if (!key) return fail(err(NOT_FOUND, "session not found"));
			const removed = removeSession(sessionStorePath, key);
			if (!removed) return fail(err(NOT_FOUND, "session not found"));
			return ok({ removed: true, sessionKey: key });
		},

		"sessions.getTree": async (params: Record<string, unknown>): Promise<GatewayResponse> => {
			const sessionKey = (params?.sessionKey as string)?.trim();
			const sessionId = (params?.sessionId as string)?.trim();
			if (!sessionKey && !sessionId) {
				return fail(err(INVALID_REQUEST, "sessions.getTree requires params.sessionKey or params.sessionId"));
			}
			const store = loadSessionStore(sessionStorePath, { skipCache: true });
			let key: string | undefined;
			let entry: SessionEntry | undefined;
			if (sessionKey && store[sessionKey]) {
				key = sessionKey;
				entry = store[sessionKey];
			} else if (sessionId) {
				const found = Object.entries(store).find(([, e]) => e.sessionId === sessionId);
				if (found) [key, entry] = [found[0], found[1]];
			}
			if (!key || !entry) return fail(err(NOT_FOUND, "session not found"));
			const transcriptPath = entry.transcriptPath ?? getTranscriptPathForSessionKey(sessionStorePath, key);
			const { header, entries } = loadTranscriptTree(transcriptPath);
			return ok({
				sessionKey: key,
				sessionId: entry.sessionId,
				currentLeafId: entry.leafId ?? null,
				header: header ?? null,
				entries: entries.map((e) => ({
					id: e.id,
					parentId: e.parentId,
					timestamp: e.timestamp,
					message: e.message,
				})),
			});
		},

		"sessions.navigate": async (params: Record<string, unknown>): Promise<GatewayResponse> => {
			const sessionKey = (params?.sessionKey as string)?.trim();
			const sessionId = (params?.sessionId as string)?.trim();
			const leafId = params?.leafId == null ? undefined : String(params.leafId);
			if (leafId === undefined) {
				return fail(err(INVALID_REQUEST, "sessions.navigate requires params.leafId"));
			}
			const store = loadSessionStore(sessionStorePath, { skipCache: true });
			let key: string | undefined;
			if (sessionKey && store[sessionKey]) key = sessionKey;
			else if (sessionId) {
				const found = Object.entries(store).find(([, e]) => e.sessionId === sessionId);
				if (found) key = found[0];
			}
			if (!key) return fail(err(NOT_FOUND, "session not found"));
			updateSessionEntry(sessionStorePath, key, { leafId: leafId || null });
			const updated = loadSessionStore(sessionStorePath, { skipCache: true })[key]!;
			return ok({ sessionKey: key, leafId: updated.leafId ?? null });
		},

		"sessions.fork": async (params: Record<string, unknown>): Promise<GatewayResponse> => {
			const sessionKey = (params?.sessionKey as string)?.trim();
			const sessionId = (params?.sessionId as string)?.trim();
			const parentLeafId = params?.parentLeafId == null ? undefined : String(params.parentLeafId);
			const store = loadSessionStore(sessionStorePath, { skipCache: true });
			let key: string | undefined;
			let entry: SessionEntry | undefined;
			if (sessionKey && store[sessionKey]) {
				key = sessionKey;
				entry = store[sessionKey];
			} else if (sessionId) {
				const found = Object.entries(store).find(([, e]) => e.sessionId === sessionId);
				if (found) [key, entry] = [found[0], found[1]];
			}
			if (!key || !entry) return fail(err(NOT_FOUND, "session not found"));
			const baseLeafId = parentLeafId ?? entry.leafId ?? null;
			const now = Date.now();
			const agentPrefix = getFirstAgentId(connections) ?? "default";
			const newKey = `agent:${agentPrefix}:s-${now}-${Math.random().toString(36).slice(2, 10)}`;
			const newSessionId = `s-${now}-${Math.random().toString(36).slice(2, 10)}`;
			const newTranscriptPath = getTranscriptPathForSessionKey(sessionStorePath, newKey);
			const transcriptPath = entry.transcriptPath ?? getTranscriptPathForSessionKey(sessionStorePath, key);
			const fs = await import("node:fs");
			if (fs.existsSync(transcriptPath)) {
				fs.copyFileSync(transcriptPath, newTranscriptPath);
			} else {
				initTranscript(newTranscriptPath, newSessionId);
			}
			const newEntry: SessionEntry = {
				sessionId: newSessionId,
				updatedAt: now,
				transcriptPath: newTranscriptPath,
				displayName: newKey.split(":").pop() ?? newSessionId.slice(0, 12),
				channel: entry.channel ?? "webchat",
				leafId: baseLeafId,
			};
			updateSessionStoreSync(sessionStorePath, (s) => {
				s[newKey] = newEntry;
			});
			return ok({ sessionKey: newKey, sessionId: newSessionId, leafId: baseLeafId });
		},

		agent: async (params: Record<string, unknown>, req?: RequestContext): Promise<GatewayResponse> => {
			const message = params?.message;
			if (typeof message !== "string") return fail(err(INVALID_REQUEST, "agent requires params.message"));

			const agentId = (params?.agentId as string)?.trim() || (getFirstAgentId(connections) ?? "");
			if (!agentId)
				return fail(err(INVALID_REQUEST, "agent requires params.agentId or at least one connected agent"));
			const nodeId = params?.nodeId as string | undefined;
			const deviceId = params?.deviceId as string | undefined;
			const connectorId = params?.connectorId as string | undefined;

			// 按 agentId 派发到已连接的 agent：找到连接则转发 node.invoke
			const nodes = getNodesFromConnections(connections);
			const agentSlot = nodes.flatMap((n) => n.agents).find((a) => a.agentId === agentId);
			const connId = agentSlot?.connId;
			if (typeof connId === "string" && connId.length > 0) {
				const entry = connections.get(connId);
				if (entry?.ws.readyState === 1) {
					const sessionKey = (params?.sessionKey as string)?.trim() || req?.entry?.sessionKey?.trim();
					const sessionId = (params?.sessionId as string)?.trim();
					const store = loadSessionStore(sessionStorePath, { skipCache: true });
					const resolveOpts = { storePath: sessionStorePath, resetPolicy };
					const {
						sessionKey: resolvedKey,
						transcriptPath,
						entry: remoteEntry,
					} = resolveSession(
						store,
						{ sessionKey: sessionKey || undefined, sessionId },
						mainTranscriptPath,
						resolveOpts,
					);
					const stored = loadTranscript(transcriptPath, remoteEntry?.leafId ?? undefined);
					const initialMessages = stored.map((m) => ({
						role: m.role,
						content: m.content,
						...(m.role === "assistant" && m.toolCalls?.length && { toolCalls: m.toolCalls }),
						...(m.role === "toolResult" && m.toolCallId && { toolCallId: m.toolCallId }),
						...(m.role === "toolResult" && m.isError !== undefined && { isError: m.isError }),
					}));
					// 先写 user，便于 progress 时前端即可看到「用户已发」；同内容 user 去重
					const { leafId: leafAfterUser, appended: userAppended } = appendUserOnceIfNotDuplicate(
						transcriptPath,
						remoteEntry?.leafId ?? null,
						message as string,
					);
					if (userAppended) {
						updateSessionEntry(sessionStorePath, resolvedKey, { leafId: leafAfterUser, updatedAt: Date.now() });
					} else {
						// 重复 user（含「同内容 user->assistant」）：不 invoke，仅同步 leafId 后返回
						updateSessionEntry(sessionStorePath, resolvedKey, {
							leafId: leafAfterUser,
							updatedAt: Date.now(),
						});
						return ok({ leafId: leafAfterUser, text: "" });
					}
					const id = nextInvokeId();
					invokeIdToSession.set(id, {
						sessionKey: resolvedKey,
						transcriptPath,
						leafId: leafAfterUser,
						sessionStorePath,
						resolvedKey,
						appendedTurnCount: 1,
					});
					return new Promise<GatewayResponse>((resolve) => {
						const timeout = setTimeout(() => {
							invokeIdToSession.delete(id);
							if (ctx.pendingInvokes.delete(id)) resolve(fail(err(504, "agent on node timeout")));
						}, 120_000);
						ctx.pendingInvokes.set(id, (result: unknown) => {
							clearTimeout(timeout);
							ctx.pendingInvokes.delete(id);
							const out =
								typeof result === "object" && result !== null && "text" in result
									? (result as {
											text: string;
											toolCalls?: Array<{ name: string; arguments?: string }>;
											turnMessages?: TurnMessageWire[];
										})
									: { text: String(result ?? ""), toolCalls: [] };
							try {
								const info = invokeIdToSession.get(id);
								invokeIdToSession.delete(id);
								if (info) {
									const assistantContent = replaceAttachmentPlaceholderWithPendingUrl(
										saveScreenshotsInContent(out.text, info.resolvedKey, ctx.screenshotsDir),
										ctx.screenshotsDir,
									);
									if (Array.isArray(out.turnMessages) && out.turnMessages.length > info.appendedTurnCount) {
										const remaining = out.turnMessages.slice(info.appendedTurnCount);
										let toAppend = turnMessagesToStored(remaining, {
											lastAssistantContent: assistantContent,
										});
										toAppend = stripLeadingUserIfInTranscript(
											info.transcriptPath,
											info.leafId,
											toAppend,
										);
										if (toAppend.length > 0) {
											const newLeafId = appendTranscriptMessages(
												info.transcriptPath,
												info.leafId,
												toAppend,
											);
											updateSessionEntry(info.sessionStorePath, info.resolvedKey, {
												leafId: newLeafId,
												updatedAt: Date.now(),
											});
										}
									} else {
										// 无剩余 turnMessages 时只追加最终 assistant
										const toAppend = [{ role: "assistant" as const, content: assistantContent }];
										const newLeafId = appendTranscriptMessages(
											info.transcriptPath,
											info.leafId,
											toAppend,
										);
										updateSessionEntry(info.sessionStorePath, info.resolvedKey, {
											leafId: newLeafId,
											updatedAt: Date.now(),
										});
									}
								} else {
									let toAppend = buildToAppendFromRemoteResult(
										out,
										message as string,
										resolvedKey,
										ctx.screenshotsDir,
									);
									toAppend = stripLeadingUserIfInTranscript(
										transcriptPath,
										remoteEntry?.leafId ?? null,
										toAppend,
									);
									if (toAppend.length > 0) {
										const newLeafId = appendTranscriptMessages(
											transcriptPath,
											remoteEntry?.leafId ?? null,
											toAppend,
										);
										updateSessionEntry(sessionStorePath, resolvedKey, { leafId: newLeafId, updatedAt: Date.now() });
									}
								}
							} catch (_) {}
							const textForAgent = replaceAttachmentPlaceholderWithPendingUrl(
								saveScreenshotsInContent(out.text, resolvedKey, ctx.screenshotsDir),
								ctx.screenshotsDir,
							);
							resolve(ok({ ...out, text: textForAgent }));
						});
						entry.ws.send(
							JSON.stringify({
								event: "node.invoke.request",
								payload: { id, __agent: true, message, initialMessages },
							}),
						);
					});
				}
			}

			let targetNodeId = nodeId ?? deviceId;
			if (connectorId && connectorMappings.length > 0) {
				const mapping = connectorMappings.find((m) => m.connectorId === connectorId);
				if (mapping) targetNodeId = targetNodeId ?? mapping.nodeId ?? mapping.deviceId;
			}

			if (targetNodeId) {
				const nodes = getNodesFromConnections(connections);
				const node = nodes.find(
					(n) => n.nodeId === targetNodeId || n.deviceId === targetNodeId || n.connId === targetNodeId,
				);
				if (node) {
					const entry = connections.get(node.connId);
					if (entry?.ws.readyState === 1) {
						const sessionKey = (params?.sessionKey as string)?.trim() || req?.entry?.sessionKey?.trim();
						const sessionId = (params?.sessionId as string)?.trim();
						const store = loadSessionStore(sessionStorePath, { skipCache: true });
						const resolveOpts = { storePath: sessionStorePath, resetPolicy };
						const {
							sessionKey: resolvedKey,
							transcriptPath,
							entry: remoteEntry,
						} = resolveSession(
							store,
							{ sessionKey: sessionKey || undefined, sessionId },
							mainTranscriptPath,
							resolveOpts,
						);
						const stored = loadTranscript(transcriptPath, remoteEntry?.leafId ?? undefined);
						const initialMessages = stored.map((m) => ({
							role: m.role,
							content: m.content,
							...(m.role === "assistant" && m.toolCalls?.length && { toolCalls: m.toolCalls }),
							...(m.role === "toolResult" && m.toolCallId && { toolCallId: m.toolCallId }),
							...(m.role === "toolResult" && m.isError !== undefined && { isError: m.isError }),
						}));
						const id = nextInvokeId();
						return new Promise<GatewayResponse>((resolve) => {
							const timeout = setTimeout(() => {
								if (ctx.pendingInvokes.delete(id)) resolve(fail(err(504, "agent on node timeout")));
							}, 120_000);
							ctx.pendingInvokes.set(id, (result: unknown) => {
								clearTimeout(timeout);
								ctx.pendingInvokes.delete(id);
								const out =
									typeof result === "object" && result !== null && "text" in result
										? (result as {
												text: string;
												toolCalls?: Array<{ name: string; arguments?: string }>;
												turnMessages?: TurnMessageWire[];
											})
										: { text: String(result ?? ""), toolCalls: [] };
								try {
									let toAppend = buildToAppendFromRemoteResult(
										out,
										message as string,
										resolvedKey,
										ctx.screenshotsDir,
									);
									toAppend = stripLeadingUserIfInTranscript(
										transcriptPath,
										remoteEntry?.leafId ?? null,
										toAppend,
									);
									if (toAppend.length > 0) {
										const newLeafId = appendTranscriptMessages(
											transcriptPath,
											remoteEntry?.leafId ?? null,
											toAppend,
										);
										updateSessionEntry(sessionStorePath, resolvedKey, {
											leafId: newLeafId,
											updatedAt: Date.now(),
										});
									}
								} catch (_) {}
								const textForAgent = replaceAttachmentPlaceholderWithPendingUrl(
									saveScreenshotsInContent(out.text, resolvedKey, ctx.screenshotsDir),
									ctx.screenshotsDir,
								);
								resolve(ok({ ...out, text: textForAgent }));
							});
							entry.ws.send(
								JSON.stringify({
									event: "node.invoke.request",
									payload: { id, __agent: true, message, initialMessages },
								}),
							);
						});
					}
				}
			}

			return fail(
				err(503, `agent ${agentId} not connected (ensure the agent is running and connected to this gateway)`),
			);
		},

		"agent.wait": async (params: Record<string, unknown>): Promise<GatewayResponse> => {
			const runId = (params?.runId as string)?.trim();
			if (!runId) return fail(err(INVALID_REQUEST, "agent.wait requires params.runId"));
			const promise = runIdToPromise.get(runId);
			if (!promise) return fail(err(NOT_FOUND, "run not found or already finished"));
			try {
				const result = await promise;
				return ok(result);
			} catch (e) {
				return fail(err(500, (e as Error).message));
			}
		},

		"chat.send": async (params: Record<string, unknown>, req?: RequestContext): Promise<GatewayResponse> => {
			const message = params?.message;
			if (typeof message !== "string") return fail(err(INVALID_REQUEST, "chat.send requires params.message"));
			const sessionKey = (params?.sessionKey as string)?.trim() || req?.entry?.sessionKey?.trim();
			const sessionId = (params?.sessionId as string)?.trim();
			const store = loadSessionStore(sessionStorePath, { skipCache: true });
			const resolveOpts = { storePath: sessionStorePath, resetPolicy };
			const {
				sessionKey: resolvedKey,
				transcriptPath,
				entry: resolvedEntry,
			} = resolveSession(store, { sessionKey: sessionKey || undefined, sessionId }, mainTranscriptPath, resolveOpts);
			const isGroup = resolvedEntry?.sessionType === "group";
			const replyModeAll = isGroup && params?.replyMode === "all";
			const replyModeTask = isGroup && (params?.replyMode === "task" || params?.replyMode === "taskRoundRobin");
			const agentId = isGroup
				? resolveGroupAgentId(resolvedEntry!, message as string)
				: (params?.agentId as string)?.trim() || (getFirstAgentId(connections) ?? "");
			if (!isGroup && !agentId)
				return fail(
					err(
						INVALID_REQUEST,
						"chat.send requires params.agentId or at least one connected agent (no default .u)",
					),
				);

			if (replyModeTask) {
				const participants = resolvedEntry?.participantAgentIds ?? [];
				if (participants.length === 0)
					return fail(err(INVALID_REQUEST, "chat.send replyMode task requires participantAgentIds"));
				const nodesTask = getNodesFromConnections(connections);
				const connectedIds = participants.filter((aid) => {
					const slot = nodesTask.flatMap((n) => n.agents).find((a) => a.agentId === aid);
					const ent = slot?.connId != null && slot.connId !== "" ? connections.get(slot.connId) : undefined;
					return ent?.ws.readyState === 1;
				});
				if (connectedIds.length === 0) return fail(err(503, "no connected participants for task round-robin"));
				const maxRounds = Math.min(Number(params?.maxRounds) || 20, 50);
				const donePattern = /任务完成|\[done\]|\[任务完成\]|done:\s*true/i;
				const toAppendUser = [{ role: "user" as const, content: message as string }];
				const leafAfterUser = appendTranscriptMessages(transcriptPath, resolvedEntry?.leafId ?? null, toAppendUser);
				updateSessionEntry(sessionStorePath, resolvedKey, { leafId: leafAfterUser, updatedAt: Date.now() });
				let currentLeafId: string | null = leafAfterUser;
				let lastOut: { text: string } = { text: "" };
				let rounds = 0;
				for (let r = 0; r < maxRounds; r++) {
					const aid = connectedIds[r % connectedIds.length]!;
					const slot = nodesTask.flatMap((n) => n.agents).find((a) => a.agentId === aid);
					const cid = slot?.connId;
					const ent = typeof cid === "string" && cid.length > 0 ? connections.get(cid) : undefined;
					if (!ent || ent.ws.readyState !== 1) continue;
					const stored = loadTranscript(transcriptPath, currentLeafId ?? undefined);
					const initialMessages = stored.map((m) => ({
						role: m.role,
						content: m.content,
						...(m.role === "assistant" && m.toolCalls?.length && { toolCalls: m.toolCalls }),
						...(m.role === "toolResult" && m.toolCallId && { toolCallId: m.toolCallId }),
						...(m.role === "toolResult" && m.isError !== undefined && { isError: m.isError }),
					}));
					const id = nextInvokeId();
					const out = await new Promise<{ text: string }>((resolvePromise) => {
						const timeout = setTimeout(() => {
							if (pendingInvokes.delete(id)) resolvePromise({ text: "(timeout)" });
						}, 120_000);
						pendingInvokes.set(id, (result: unknown) => {
							clearTimeout(timeout);
							pendingInvokes.delete(id);
							const o =
								typeof result === "object" && result !== null && "text" in result
									? (result as { text: string }).text
									: String(result ?? "");
							resolvePromise({ text: o });
						});
						ent.ws.send(
							JSON.stringify({
								event: "node.invoke.request",
								payload: { id, __agent: true, message, initialMessages },
							}),
						);
					}).catch(() => ({ text: "" }));
					const withUrls = saveScreenshotsInContent(out.text, resolvedKey, ctx.screenshotsDir);
					const assistantContent = replaceAttachmentPlaceholderWithPendingUrl(withUrls, ctx.screenshotsDir);
					const toAppendAssistant = [
						{ role: "assistant" as const, content: assistantContent, senderAgentId: aid },
					];
					currentLeafId = appendTranscriptMessages(transcriptPath, currentLeafId, toAppendAssistant);
					updateSessionEntry(sessionStorePath, resolvedKey, { leafId: currentLeafId, updatedAt: Date.now() });
					lastOut = out;
					rounds = r + 1;
					if (donePattern.test(out.text)) break;
				}
				return ok({ ...lastOut, taskDone: true, rounds });
			}

			if (replyModeAll) {
				const participants = resolvedEntry?.participantAgentIds ?? [];
				if (participants.length === 0)
					return fail(err(INVALID_REQUEST, "chat.send replyMode all requires participantAgentIds"));
				const toAppendUser = [{ role: "user" as const, content: message as string }];
				const leafAfterUser = appendTranscriptMessages(transcriptPath, resolvedEntry?.leafId ?? null, toAppendUser);
				updateSessionEntry(sessionStorePath, resolvedKey, { leafId: leafAfterUser, updatedAt: Date.now() });
				const nodesAll = getNodesFromConnections(connections);
				let currentLeafId: string | null = leafAfterUser;
				let lastOut: { text: string; toolCalls?: Array<{ name: string; arguments?: string }> } = { text: "" };
				let repliedCount = 0;
				for (const aid of participants) {
					const slot = nodesAll.flatMap((n) => n.agents).find((a) => a.agentId === aid);
					const cid = slot?.connId;
					const ent = typeof cid === "string" && cid.length > 0 ? connections.get(cid) : undefined;
					if (!ent || ent.ws.readyState !== 1) continue;
					const stored = loadTranscript(transcriptPath, currentLeafId ?? undefined);
					const initialMessages = stored.map((m) => ({
						role: m.role,
						content: m.content,
						...(m.role === "assistant" && m.toolCalls?.length && { toolCalls: m.toolCalls }),
						...(m.role === "toolResult" && m.toolCallId && { toolCallId: m.toolCallId }),
						...(m.role === "toolResult" && m.isError !== undefined && { isError: m.isError }),
					}));
					const id = nextInvokeId();
					const out = await new Promise<{ text: string; toolCalls?: Array<{ name: string; arguments?: string }> }>(
						(resolvePromise, rejectPromise) => {
							const timeout = setTimeout(() => {
								if (pendingInvokes.delete(id)) resolvePromise({ text: "(timeout)" });
								else rejectPromise(new Error("timeout"));
							}, 120_000);
							pendingInvokes.set(id, (result: unknown) => {
								clearTimeout(timeout);
								pendingInvokes.delete(id);
								const o =
									typeof result === "object" && result !== null && "text" in result
										? (result as { text: string; toolCalls?: Array<{ name: string; arguments?: string }> })
										: {
												text: String(result ?? ""),
												toolCalls: [] as Array<{ name: string; arguments?: string }>,
											};
								resolvePromise(o);
							});
							ent.ws.send(
								JSON.stringify({
									event: "node.invoke.request",
									payload: { id, __agent: true, message, initialMessages },
								}),
							);
						},
					).catch(() => ({ text: "", toolCalls: [] as Array<{ name: string; arguments?: string }> }));
					const withUrls = saveScreenshotsInContent(out.text, resolvedKey, ctx.screenshotsDir);
					const assistantContent = replaceAttachmentPlaceholderWithPendingUrl(withUrls, ctx.screenshotsDir);
					const toAppendAssistant = [
						{ role: "assistant" as const, content: assistantContent, senderAgentId: aid },
					];
					currentLeafId = appendTranscriptMessages(transcriptPath, currentLeafId, toAppendAssistant);
					updateSessionEntry(sessionStorePath, resolvedKey, { leafId: currentLeafId, updatedAt: Date.now() });
					lastOut = out;
					repliedCount += 1;
				}
				return ok({ ...lastOut, allReplied: true, count: repliedCount });
			}

			if (ctx.sessionQueue && isSessionActive(ctx.sessionQueue, resolvedKey)) {
				enqueue(ctx.sessionQueue, resolvedKey, message);
				return ok({ queued: true });
			}

			// 根据 agentId 找到对应连接：远程 agent 有非空 connId，本机 .u 为 connId ""
			const nodes = getNodesFromConnections(connections);
			const agentSlot = nodes.flatMap((n) => n.agents).find((a) => a.agentId === agentId);
			const connId = agentSlot?.connId;
			const isRemote = typeof connId === "string" && connId.length > 0;
			if (process.env.GATEWAY_DEBUG_MEMORY) {
				process.stderr.write(
					`[gateway] chat.send isRemote=${isRemote} connId=${connId ?? "null"} nodes=${nodes.length}\n`,
				);
			}

			const runOneTurnRemote = async (sk: string, msg: string): Promise<void> => {
				const st = loadSessionStore(sessionStorePath, { skipCache: true });
				const res = resolveSession(st, { sessionKey: sk }, mainTranscriptPath, resolveOpts);
				const tpath = res.transcriptPath;
				const rkey = res.sessionKey;
				const stored = loadTranscript(tpath, res.entry?.leafId ?? undefined);
				const initialMessages = stored.map((m) => ({
					role: m.role,
					content: m.content,
					...(m.role === "assistant" && m.toolCalls?.length && { toolCalls: m.toolCalls }),
					...(m.role === "toolResult" && m.toolCallId && { toolCallId: m.toolCallId }),
					...(m.role === "toolResult" && m.isError !== undefined && { isError: m.isError }),
				}));
				const n = getNodesFromConnections(connections);
				const slot = n.flatMap((no) => no.agents).find((a) => a.agentId === agentId);
				const cid = slot?.connId;
				const ent = typeof cid === "string" && cid.length > 0 ? connections.get(cid) : undefined;
				if (!ent || ent.ws.readyState !== 1) return;
				const id = nextInvokeId();
				if (ctx.sessionQueue) setActiveRun(ctx.sessionQueue, rkey, id);
				await new Promise<void>((resolvePromise) => {
					const timeout = setTimeout(() => {
						if (pendingInvokes.delete(id)) {
							if (ctx.sessionQueue) clearActiveRunByRunId(ctx.sessionQueue, id);
							resolvePromise();
						}
					}, 120_000);
					pendingInvokes.set(id, (result: unknown) => {
						clearTimeout(timeout);
						pendingInvokes.delete(id);
						const out =
							typeof result === "object" && result !== null && "text" in result
								? (result as {
										text: string;
										toolCalls?: Array<{ name: string; arguments?: string }>;
										turnMessages?: TurnMessageWire[];
									})
								: { text: String(result ?? ""), toolCalls: [] };
						try {
							const senderAgentId = res.entry?.sessionType === "group" ? agentId : undefined;
							let toAppend = buildToAppendFromRemoteResult(out, msg, rkey, ctx.screenshotsDir, senderAgentId);
							toAppend = stripLeadingUserIfInTranscript(tpath, res.entry?.leafId ?? null, toAppend);
							if (toAppend.length > 0) {
								const newLeafId = appendTranscriptMessages(tpath, res.entry?.leafId ?? null, toAppend);
								updateSessionEntry(sessionStorePath, rkey, { leafId: newLeafId, updatedAt: Date.now() });
							}
						} catch (_) {}
						if (ctx.sessionQueue) {
							clearActiveRunByRunId(ctx.sessionQueue, id);
							onRunComplete(ctx.sessionQueue, rkey, (merged) => runOneTurnRemote(rkey, merged));
						}
						resolvePromise();
					});
					ent.ws.send(
						JSON.stringify({
							event: "node.invoke.request",
							payload: { id, __agent: true, message: msg, initialMessages },
						}),
					);
				});
			};

			if (isRemote) {
				const entry = connections.get(connId!);
				if (!entry || entry.ws.readyState !== 1) return fail(err(503, `agent ${agentId} not connected`));
				const { leafId: leafAfterUser, appended: userAppended } = appendUserOnceIfNotDuplicate(
					transcriptPath,
					resolvedEntry?.leafId ?? null,
					message as string,
				);
				if (userAppended) {
					updateSessionEntry(sessionStorePath, resolvedKey, { leafId: leafAfterUser, updatedAt: Date.now() });
				} else {
					// 重复 user（含「同内容 user->assistant」）：不 invoke，仅同步 leafId 后返回
					updateSessionEntry(sessionStorePath, resolvedKey, { leafId: leafAfterUser, updatedAt: Date.now() });
					return ok({ leafId: leafAfterUser, text: "" });
				}
				const id = nextInvokeId();
				invokeIdToSession.set(id, {
					sessionKey: resolvedKey,
					transcriptPath,
					leafId: leafAfterUser,
					sessionStorePath,
					resolvedKey,
					appendedTurnCount: 1,
				});
				if (ctx.sessionQueue) setActiveRun(ctx.sessionQueue, resolvedKey, id);
				const stored = loadTranscript(transcriptPath, resolvedEntry?.leafId ?? undefined);
				const initialMessages = stored.map((m) => ({
					role: m.role,
					content: m.content,
					...(m.role === "assistant" && m.toolCalls?.length && { toolCalls: m.toolCalls }),
					...(m.role === "toolResult" && m.toolCallId && { toolCallId: m.toolCallId }),
					...(m.role === "toolResult" && m.isError !== undefined && { isError: m.isError }),
				}));
				if (process.env.GATEWAY_DEBUG_MEMORY) {
					process.stderr.write(
						`[gateway] chat.send remote initialMessages=${initialMessages.length} leafId=${leafAfterUser}\n`,
					);
				}
				return new Promise<GatewayResponse>((resolve) => {
					const timeout = setTimeout(() => {
						invokeIdToSession.delete(id);
						if (pendingInvokes.delete(id)) {
							if (ctx.sessionQueue) clearActiveRunByRunId(ctx.sessionQueue, id);
							resolve(fail(err(504, "agent response timeout")));
						}
					}, 120_000);
					pendingInvokes.set(id, (result: unknown) => {
						clearTimeout(timeout);
						pendingInvokes.delete(id);
						const out =
							typeof result === "object" && result !== null && "text" in result
								? (result as {
										text: string;
										toolCalls?: Array<{ name: string; arguments?: string }>;
										turnMessages?: TurnMessageWire[];
									})
								: { text: String(result ?? ""), toolCalls: [] };
						try {
							const senderAgentId = isGroup ? agentId : undefined;
							const info = invokeIdToSession.get(id);
							invokeIdToSession.delete(id);
							if (info) {
								const assistantContent = replaceAttachmentPlaceholderWithPendingUrl(
									saveScreenshotsInContent(out.text, info.resolvedKey, ctx.screenshotsDir),
									ctx.screenshotsDir,
								);
								if (Array.isArray(out.turnMessages) && out.turnMessages.length > info.appendedTurnCount) {
									const remaining = out.turnMessages.slice(info.appendedTurnCount);
									let toAppend = turnMessagesToStored(remaining, {
										lastAssistantContent: assistantContent,
										senderAgentId,
									});
									toAppend = stripLeadingUserIfInTranscript(
										info.transcriptPath,
										info.leafId,
										toAppend,
									);
									if (toAppend.length > 0) {
										const newLeafId = appendTranscriptMessages(info.transcriptPath, info.leafId, toAppend);
										updateSessionEntry(info.sessionStorePath, info.resolvedKey, {
											leafId: newLeafId,
											updatedAt: Date.now(),
										});
									}
								} else {
									const toAppend = [
										{
											role: "assistant" as const,
											content: assistantContent,
											...(senderAgentId && { senderAgentId }),
										},
									];
									const newLeafId = appendTranscriptMessages(info.transcriptPath, info.leafId, toAppend);
									updateSessionEntry(info.sessionStorePath, info.resolvedKey, {
										leafId: newLeafId,
										updatedAt: Date.now(),
									});
								}
							} else {
								let toAppend = buildToAppendFromRemoteResult(
									out,
									message,
									resolvedKey,
									ctx.screenshotsDir,
									senderAgentId,
								);
								toAppend = stripLeadingUserIfInTranscript(
									transcriptPath,
									resolvedEntry?.leafId ?? null,
									toAppend,
								);
								if (toAppend.length > 0) {
									const current = loadTranscript(transcriptPath, resolvedEntry?.leafId ?? undefined);
									const lastCurrent = current[current.length - 1];
									const lastToAppend = toAppend[toAppend.length - 1]!;
									const sameTail =
										lastToAppend.role === "assistant" &&
										!(lastToAppend.toolCalls?.length) &&
										lastCurrent?.role === "assistant" &&
										(lastCurrent.content ?? "").trim() === (lastToAppend.content ?? "").trim();
									if (!sameTail) {
										const newLeafId = appendTranscriptMessages(
											transcriptPath,
											resolvedEntry?.leafId ?? null,
											toAppend,
										);
										updateSessionEntry(sessionStorePath, resolvedKey, { leafId: newLeafId, updatedAt: Date.now() });
									}
								}
							}
						} catch (_) {}
						if (ctx.sessionQueue) {
							clearActiveRunByRunId(ctx.sessionQueue, id);
							onRunComplete(ctx.sessionQueue, resolvedKey, (merged) => runOneTurnRemote(resolvedKey, merged));
						}
						const textForAgent = replaceAttachmentPlaceholderWithPendingUrl(
							saveScreenshotsInContent(out.text, resolvedKey, ctx.screenshotsDir),
							ctx.screenshotsDir,
						);
						resolve(ok({ ...out, text: textForAgent }));
					});
					entry!.ws.send(
						JSON.stringify({
							event: "node.invoke.request",
							payload: { id, __agent: true, message, initialMessages },
						}),
					);
				});
			}

			return fail(
				err(503, `agent ${agentId} not connected (ensure the agent is running and connected to this gateway)`),
			);
		},

		"chat.abort": async (params: Record<string, unknown>): Promise<GatewayResponse> => {
			const runId = (params?.runId as string)?.trim();
			if (!runId) return fail(err(INVALID_REQUEST, "chat.abort requires params.runId"));
			const controller = runIdToAbort.get(runId);
			if (!controller) return fail(err(NOT_FOUND, "run not found or already finished"));
			controller.abort();
			runIdToAbort.delete(runId);
			return ok({ runId, aborted: true });
		},

		"skills.status": async (params: Record<string, unknown>): Promise<GatewayResponse> => {
			try {
				const agentId = (params?.agentId as string)?.trim() || (getFirstAgentId(connections) ?? "");
				if (!agentId) return ok({ skillDirs: [], tools: [] });
				const agentDir = path.join(ctx.rootDir, "agents", agentId);
				const { buildSessionFromU } = await import("@monou/agent-from-dir");
				const session = await buildSessionFromU(ctx.rootDir, { agentDir });
				return ok({
					skillDirs: session.skillDirs,
					tools: session.mergedTools.map((t) => t.name),
				});
			} catch (e) {
				return fail(err(500, (e as Error).message));
			}
		},

		"chat.history": async (params: Record<string, unknown>, req?: RequestContext): Promise<GatewayResponse> => {
			const sessionKey = (params?.sessionKey as string)?.trim() || req?.entry?.sessionKey?.trim();
			const sessionId = (params?.sessionId as string)?.trim();
			const limit = typeof params?.limit === "number" ? Math.min(Math.max(0, params.limit), 500) : 100;
			// skipCache：保证新建会话刚写入 store 后能立即读到；storePath：未命中时用正确 transcript 路径而非 main
			const store = loadSessionStore(sessionStorePath, { skipCache: true });
			const { transcriptPath, entry: historyEntry } = resolveSession(
				store,
				{ sessionKey: sessionKey || undefined, sessionId },
				mainTranscriptPath,
				{ storePath: sessionStorePath },
			);
			const stored = loadTranscript(transcriptPath, historyEntry?.leafId);
			const messages = stored.slice(-limit).map((m) => ({
				role: m.role,
				content: m.content ?? "",
				...(m.toolCalls && { toolCalls: m.toolCalls }),
				...(m.toolCallId && { toolCallId: m.toolCallId }),
				...(m.isError !== undefined && { isError: m.isError }),
				...(m.senderAgentId && { senderAgentId: m.senderAgentId }),
			}));
			return ok({ messages });
		},

		"node.list": async (): Promise<GatewayResponse> => {
			const nodes = getNodesFromConnections(connections);
			const connectors = getConnectorsFromConnections(connections);
			return ok({
				nodes: nodes.map((n) => ({
					nodeId: n.nodeId,
					deviceId: n.deviceId,
					connId: n.connId,
					agents: n.agents,
					...(n.capabilities?.length ? { capabilities: n.capabilities } : {}),
					...(n.vncPort != null ? { vncPort: n.vncPort } : {}),
				})),
				connectors: connectors.map((c) => ({
					connectorId: c.connectorId,
					connId: c.connId,
					online: c.online,
					displayName: c.displayName,
				})),
			});
		},

		"node.invoke": async (params: Record<string, unknown>): Promise<GatewayResponse> => {
			const nodeId = params?.nodeId as string | undefined;
			if (typeof nodeId !== "string") return fail(err(INVALID_REQUEST, "node.invoke requires params.nodeId"));
			const nodes = getNodesFromConnections(connections);
			const node = nodes.find((n) => n.nodeId === nodeId || n.deviceId === nodeId || n.connId === nodeId);
			if (!node) return fail(err(NOT_FOUND, `node not found: ${nodeId}`));
			const entry = connections.get(node.connId);
			if (!entry || entry.ws.readyState !== 1) return fail(err(503, "node not connected"));
			const id = nextInvokeId();
			const payload = { id, ...params };
			return new Promise<GatewayResponse>((resolve) => {
				const timeout = setTimeout(() => {
					if (pendingInvokes.delete(id)) resolve(fail(err(504, "node.invoke timeout")));
				}, 60_000);
				pendingInvokes.set(id, (result: unknown) => {
					clearTimeout(timeout);
					pendingInvokes.delete(id);
					resolve(ok({ id, result }));
				});
				entry.ws.send(JSON.stringify({ event: "node.invoke.request", payload }));
			});
		},

		"node.invoke.progress": async (params: Record<string, unknown>): Promise<GatewayResponse> => {
			const id = params?.id;
			const turnMessages = params?.turnMessages;
			if (id == null) return fail(err(INVALID_REQUEST, "node.invoke.progress requires params.id"));
			const info = invokeIdToSession.get(String(id));
			if (info && Array.isArray(turnMessages) && turnMessages.length > info.appendedTurnCount) {
				try {
					const remaining = (turnMessages as TurnMessageWire[]).slice(info.appendedTurnCount);
					let toAppend = turnMessagesToStored(remaining);
					toAppend = stripLeadingUserIfInTranscript(info.transcriptPath, info.leafId, toAppend);
					if (toAppend.length > 0) {
						const newLeafId = appendTranscriptMessages(info.transcriptPath, info.leafId, toAppend);
						info.leafId = newLeafId;
						info.appendedTurnCount += remaining.length;
						updateSessionEntry(info.sessionStorePath, info.resolvedKey, {
							leafId: newLeafId,
							updatedAt: Date.now(),
						});
					}
				} catch (_) {
					// ignore append errors
				}
				// 无论 append 是否成功都广播，前端可拉 history 拿到当前 transcript 状态
				if (ctx.broadcast) {
					ctx.broadcast("agent.run.progress", { runId: id, sessionKey: info.sessionKey });
				}
			}
			return ok({ ok: true });
		},

		"node.invoke.result": async (params: Record<string, unknown>): Promise<GatewayResponse> => {
			const id = params?.id;
			if (id == null) return fail(err(INVALID_REQUEST, "node.invoke.result requires params.id"));
			const resolveFn = pendingInvokes.get(String(id));
			if (resolveFn) {
				pendingInvokes.delete(String(id));
				let result = params?.result ?? params;
				// browser_fetch 返回的 screenshotBase64 落盘为文件并改为 screenshotUrl，避免 Agent 把 base64 发给 LLM 超 token
				if (result && typeof result === "object" && result !== null && "payload" in result) {
					const payload = (result as { payload?: Record<string, unknown> }).payload;
					if (payload?.screenshotBase64 && typeof payload.screenshotBase64 === "string") {
						const url = saveBase64ToScreenshotFile(
							payload.screenshotBase64,
							"pending",
							String(id) + ".png",
							ctx.screenshotsDir,
						);
						const { screenshotBase64: _b, ...rest } = payload;
						result = { ...result, payload: { ...rest, screenshotUrl: url } };
					}
				}
				resolveFn(result);
			}
			return ok({ id, accepted: true });
		},

		"file.upload": async (params: Record<string, unknown>): Promise<GatewayResponse> => {
			const agentId = (params?.agentId as string)?.trim() || getFirstAgentId(connections);
			if (!agentId)
				return fail(err(INVALID_REQUEST, "file.upload requires params.agentId or at least one connected agent"));
			const filename = typeof params?.filename === "string" ? params.filename.trim() : "";
			if (!filename) return fail(err(INVALID_REQUEST, "file.upload requires params.filename"));
			const content = typeof params?.content === "string" ? params.content : "";
			const nodes = getNodesFromConnections(connections);
			const agentSlot = nodes.flatMap((n) => n.agents).find((a) => a.agentId === agentId);
			const connId = agentSlot?.connId;
			if (typeof connId !== "string" || connId.length === 0) {
				return fail(err(503, `agent ${agentId} not connected (file upload is to agent, not gateway)`));
			}
			const entry = connections.get(connId);
			if (!entry || entry.ws.readyState !== 1) {
				return fail(err(503, `agent ${agentId} connection not ready`));
			}
			const id = nextInvokeId();
			return new Promise<GatewayResponse>((resolve, reject) => {
				const timeout = setTimeout(() => {
					if (pendingFileUploads.delete(id)) resolve(fail(err(504, "file.upload timeout")));
				}, 30_000);
				pendingFileUploads.set(id, {
					resolve: (v: unknown) => {
						clearTimeout(timeout);
						pendingFileUploads.delete(id);
						resolve(ok(v as Record<string, unknown>));
					},
					reject: (e: Error) => {
						clearTimeout(timeout);
						pendingFileUploads.delete(id);
						resolve(fail(err(500, e.message)));
					},
				});
				entry!.ws.send(JSON.stringify({ event: "agent.file.upload", payload: { id, filename, content } }));
			});
		},

		"agent.file.upload.result": async (params: Record<string, unknown>): Promise<GatewayResponse> => {
			const id = params?.id;
			if (id == null) return fail(err(INVALID_REQUEST, "agent.file.upload.result requires params.id"));
			const pending = pendingFileUploads.get(String(id));
			if (pending) {
				pendingFileUploads.delete(String(id));
				const errMsg = typeof params?.error === "string" ? params.error : undefined;
				if (errMsg) pending.reject(new Error(errMsg));
				else pending.resolve({ path: params?.path ?? "" });
			}
			return ok({ id, accepted: true });
		},

		"connector.mapping.list": async (): Promise<GatewayResponse> => {
			return ok({ mappings: [...connectorMappings] });
		},

		"connector.mapping.add": async (params: Record<string, unknown>): Promise<GatewayResponse> => {
			const connectorId = params?.connectorId as string | undefined;
			const agentId = params?.agentId as string | undefined;
			if (typeof connectorId !== "string" || typeof agentId !== "string") {
				return fail(err(INVALID_REQUEST, "connector.mapping.add requires params.connectorId and params.agentId"));
			}
			const mapping: ConnectorMapping = {
				id: nextMappingId(),
				connectorId,
				channelId: typeof params?.channelId === "string" ? params.channelId : undefined,
				agentId,
				nodeId: typeof params?.nodeId === "string" ? params.nodeId : undefined,
				deviceId: typeof params?.deviceId === "string" ? params.deviceId : undefined,
			};
			connectorMappings.push(mapping);
			await persistConnectorMappings?.();
			return ok(mapping);
		},

		"connector.mapping.remove": async (params: Record<string, unknown>): Promise<GatewayResponse> => {
			const id = params?.id as string | undefined;
			if (typeof id !== "string") return fail(err(INVALID_REQUEST, "connector.mapping.remove requires params.id"));
			const idx = connectorMappings.findIndex((m) => m.id === id);
			if (idx === -1) return fail(err(NOT_FOUND, `mapping not found: ${id}`));
			const [removed] = connectorMappings.splice(idx, 1);
			await persistConnectorMappings?.();
			return ok({ id: removed.id, removed: true });
		},

		"connector.mapping.resolve": async (params: Record<string, unknown>): Promise<GatewayResponse> => {
			const connectorId = params?.connectorId as string | undefined;
			const channelId = params?.channelId as string | undefined;
			if (typeof connectorId !== "string") {
				return fail(err(INVALID_REQUEST, "connector.mapping.resolve requires params.connectorId"));
			}
			const mapping = channelId
				? connectorMappings.find((m) => m.connectorId === connectorId && m.channelId === channelId)
				: connectorMappings.find((m) => m.connectorId === connectorId);
			if (!mapping) return ok({ agentId: undefined, nodeId: undefined, deviceId: undefined });
			return ok({
				agentId: mapping.agentId,
				nodeId: mapping.nodeId,
				deviceId: mapping.deviceId,
				mappingId: mapping.id,
			});
		},

		"connector.message.inbound": async (params: Record<string, unknown>): Promise<GatewayResponse> => {
			const connectorId = (params?.connectorId as string)?.trim();
			const chatId = (params?.chatId as string)?.trim();
			const text = typeof params?.text === "string" ? params.text : String(params?.text ?? "");
			if (!connectorId || !chatId) {
				return fail(
					err(INVALID_REQUEST, "connector.message.inbound requires params.connectorId and params.chatId"),
				);
			}
			const channelId = typeof params?.channelId === "string" ? params.channelId.trim() : undefined;
			const messageId = typeof params?.messageId === "string" ? params.messageId : undefined;

			const sessionKey = `connector:${connectorId}:chat:${chatId}`;
			const store = loadSessionStore(sessionStorePath, { skipCache: true });
			const resolveOpts = { storePath: sessionStorePath, resetPolicy };
			const resolved = resolveSession(store, { sessionKey }, mainTranscriptPath, resolveOpts);
			const { entry: sessionEntry, transcriptPath, sessionKey: resolvedKey } = resolved;

			const matchSwitch = (t: string): string | null => {
				const s = t.trim();
				const m1 = /^\/agent\s+(.+)$/i.exec(s);
				if (m1) return m1[1].trim();
				const m2 = /^(与|和)\s*(.+?)\s*对话\s*$/.exec(s);
				if (m2) return m2[2].trim();
				const m3 = /^切换(至|到)?\s*(.+)$/.exec(s);
				if (m3) return m3[2].trim();
				return null;
			};
			const switchTarget = matchSwitch(text);
			if (switchTarget !== null) {
				updateSessionEntry(sessionStorePath, resolvedKey, {
					agentIdOverride: switchTarget,
					updatedAt: Date.now(),
				});
				return ok({
					replyText: `已切换到 ${switchTarget}，后续消息将由此 Agent 回复。`,
					runId: undefined,
				});
			}

			const mapping = channelId
				? connectorMappings.find((m) => m.connectorId === connectorId && m.channelId === channelId)
				: connectorMappings.find((m) => m.connectorId === connectorId);
			const agentId = sessionEntry?.agentIdOverride ?? mapping?.agentId ?? getFirstAgentId(connections) ?? "";
			const message = text || "(无文本)";

			if (ctx.sessionQueue && isSessionActive(ctx.sessionQueue, resolvedKey)) {
				enqueue(ctx.sessionQueue, resolvedKey, message);
				return ok({ queued: true });
			}

			if (!agentId) return fail(err(503, "no agent connected and no mapping; connect an agent first"));

			// 优先走已连接 agent 的 node.invoke.request
			const nodes = getNodesFromConnections(connections);
			const node = nodes.find((n) => n.agents.some((a) => a.agentId === agentId));
			const remoteEntry = node ? connections.get(node.connId) : undefined;
			if (remoteEntry?.ws.readyState === 1) {
				const id = nextInvokeId();
				if (ctx.sessionQueue) setActiveRun(ctx.sessionQueue, resolvedKey, id);
				const runOneTurnRemoteInbound = async (sk: string, msg: string): Promise<void> => {
					const st = loadSessionStore(sessionStorePath);
					const res = resolveSession(st, { sessionKey: sk }, mainTranscriptPath, resolveOpts);
					const rkey = res.sessionKey;
					const n = getNodesFromConnections(connections);
					const no = n.find((nn) => nn.agents.some((a) => a.agentId === agentId));
					const ent = no ? connections.get(no.connId) : undefined;
					if (!ent || ent.ws.readyState !== 1) return;
					const invId = nextInvokeId();
					if (ctx.sessionQueue) setActiveRun(ctx.sessionQueue, rkey, invId);
					await new Promise<void>((resolvePromise) => {
						const timeout = setTimeout(() => {
							if (pendingInvokes.delete(invId)) {
								if (ctx.sessionQueue) clearActiveRunByRunId(ctx.sessionQueue, invId);
								resolvePromise();
							}
						}, 120_000);
						pendingInvokes.set(invId, (result: unknown) => {
							clearTimeout(timeout);
							pendingInvokes.delete(invId);
							if (ctx.sessionQueue) {
								clearActiveRunByRunId(ctx.sessionQueue, invId);
								onRunComplete(ctx.sessionQueue, rkey, (merged) => runOneTurnRemoteInbound(rkey, merged));
							}
							resolvePromise();
						});
						ent.ws.send(
							JSON.stringify({
								event: "node.invoke.request",
								payload: { id: invId, __agent: true, message: msg, sessionKey: sk },
							}),
						);
					});
				};
				return new Promise<GatewayResponse>((resolve) => {
					const timeout = setTimeout(() => {
						if (pendingInvokes.delete(id)) {
							if (ctx.sessionQueue) clearActiveRunByRunId(ctx.sessionQueue, id);
							resolve(fail(err(504, "connector inbound agent timeout")));
						}
					}, 120_000);
					pendingInvokes.set(id, (result: unknown) => {
						clearTimeout(timeout);
						pendingInvokes.delete(id);
						const out =
							typeof result === "object" && result !== null && "text" in result
								? (result as { text: string })
								: { text: String(result) };
						if (ctx.sessionQueue) {
							clearActiveRunByRunId(ctx.sessionQueue, id);
							onRunComplete(ctx.sessionQueue, resolvedKey, (merged) =>
								runOneTurnRemoteInbound(resolvedKey, merged),
							);
						}
						resolve(ok({ replyText: out.text, runId: id }));
					});
					remoteEntry.ws.send(
						JSON.stringify({ event: "node.invoke.request", payload: { id, __agent: true, message, sessionKey } }),
					);
				});
			}

			return fail(err(503, `agent ${agentId} not connected (请确保该 Agent 已连上 Gateway)`));
		},

		"connector.message.push": async (params: Record<string, unknown>): Promise<GatewayResponse> => {
			const connectorId = (params?.connectorId as string)?.trim();
			const chatId = (params?.chatId as string)?.trim();
			const text = typeof params?.text === "string" ? params.text : String(params?.text ?? "");
			if (!connectorId || !chatId) {
				return fail(err(INVALID_REQUEST, "connector.message.push requires params.connectorId and params.chatId"));
			}
			const connectors = getConnectorsFromConnections(connections);
			if (!connectors.some((c) => c.connectorId === connectorId)) {
				return fail(err(503, `connector ${connectorId} not connected`));
			}
			if (!ctx.pushToConnector) {
				return fail(err(501, "pushToConnector not configured"));
			}
			const payload = {
				connectorId,
				chatId,
				channelId: typeof params?.channelId === "string" ? params.channelId : undefined,
				text,
				attachments: Array.isArray(params?.attachments) ? params.attachments : undefined,
				replyToId: typeof params?.replyToId === "string" ? params.replyToId : undefined,
			};
			ctx.pushToConnector(connectorId, "connector.message.push", payload);
			return ok({ pushed: true });
		},
	};
}

export type GatewayHandlers = ReturnType<typeof createHandlers>;

/** 供 Agent 内 message_skill、sessions_skill 调用的 Gateway RPC 封装 */
export function createGatewayInvoke(
	handlers: GatewayHandlers,
): (method: string, params: Record<string, unknown>) => Promise<unknown> {
	return async (method: string, params: Record<string, unknown>) => {
		const fn = (handlers as Record<string, (p: Record<string, unknown>) => Promise<GatewayResponse>>)[method];
		if (typeof fn !== "function") throw new Error(`Unknown method: ${method}`);
		const res = await fn(params);
		if (!res.ok) {
			const errMsg = (res as { error?: { message?: string } }).error?.message ?? "Gateway error";
			throw new Error(errMsg);
		}
		return (res as { payload: unknown }).payload;
	};
}
