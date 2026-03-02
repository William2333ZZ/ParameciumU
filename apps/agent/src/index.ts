#!/usr/bin/env node
/**
 * 启动 agent 的 app：连 Gateway、注册、收 node.invoke 派发、用 agent-from-dir 跑一轮并回传。
 * 连接成功后自动确保存在 heartbeat 定时任务（与 OpenClaw 语义对齐），由同一 runScheduler 到点跑 agent、可选 push。
 * 用法: GATEWAY_URL=ws://127.0.0.1:9347 AGENT_ID=.first_paramecium AGENT_DIR=./.first_paramecium node dist/index.js
 */

import "dotenv/config";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

/** 用户上传文件落盘目录（在 agent 所在机器，非 Gateway）；Gateway 通过 agent.file.upload 事件将文件发到此处 */
const UAGENT_TMP = path.join(os.homedir(), ".uagent_tmp");

function safeBasename(name: string): string {
	const base = path.basename(name) || "upload";
	return base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200) || "upload";
}

async function handleFileUpload(
	payload: { id?: string; filename?: string; content?: string },
	send: (obj: object) => void,
): Promise<void> {
	const id = payload?.id;
	const filename = typeof payload?.filename === "string" ? payload.filename : "";
	const content = typeof payload?.content === "string" ? payload.content : "";
	if (!id || !filename) {
		send({ method: "agent.file.upload.result", params: { id, error: "Missing id or filename" } });
		return;
	}
	try {
		await fs.mkdir(UAGENT_TMP, { recursive: true });
		const base = safeBasename(filename);
		const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}-${base}`;
		const filePath = path.join(UAGENT_TMP, unique);
		const buf = Buffer.from(content, "base64");
		await fs.writeFile(filePath, buf);
		send({ method: "agent.file.upload.result", params: { id, path: filePath } });
	} catch (e) {
		const errMsg = e instanceof Error ? e.message : String(e);
		send({ method: "agent.file.upload.result", params: { id, error: errMsg } });
	}
}
import { buildSessionFromU, createAgentContextFromU } from "@monou/agent-from-dir";
import { type AgentMessage, runAgentTurnWithTools } from "@monou/agent-sdk";
import { type CronJob, CronStore } from "@monou/cron";
import { runScheduler } from "@monou/cron/scheduler";
import { createId } from "@monou/shared";
import WebSocket from "ws";

/** 支持 GATEWAY_WS_URL（与 .env 一致），未设时回退 GATEWAY_URL */
const GATEWAY_URL = process.env.GATEWAY_WS_URL?.trim() || process.env.GATEWAY_URL?.trim();
const AGENT_ID = process.env.AGENT_ID?.trim();
const AGENT_DIR = process.env.AGENT_DIR?.trim() || process.env.AGENT_ROOT_DIR?.trim();
const DEVICE_ID = process.env.DEVICE_ID?.trim() || os.hostname() || AGENT_ID;
const TOKEN = process.env.GATEWAY_TOKEN?.trim();
const PASSWORD = process.env.GATEWAY_PASSWORD?.trim();

if (!GATEWAY_URL || !AGENT_ID) {
	console.error("需要设置 GATEWAY_URL 或 GATEWAY_WS_URL（可在 .env）以及 AGENT_ID");
	console.error(
		"示例: GATEWAY_WS_URL=ws://127.0.0.1:9347 AGENT_ID=.first_paramecium AGENT_DIR=./.first_paramecium npm run agent",
	);
	process.exit(1);
}
if (!AGENT_DIR) {
	console.error("必须显式指定 AGENT_DIR（无默认目录）");
	console.error("示例: AGENT_DIR=./.first_paramecium AGENT_ID=.first_paramecium npm run agent");
	process.exit(1);
}

const agentDir = path.resolve(AGENT_DIR);
const cronStorePath = path.join(agentDir, "cron", "jobs.json");
const rootDir = process.cwd();

/** 心跳任务在 cron store 中的名称；连接成功后若不存在则自动创建。语义：在线证明 + 周期学习/汇报（与 docs/heartbeat.md 一致） */
const HEARTBEAT_JOB_NAME = "Heartbeat";
const HEARTBEAT_EVERY_MS = 30 * 60 * 1000; // 30m
/** 默认以「学习/汇报」为心跳语义，体现不断学习；若无事则回复 HEARTBEAT_OK */
const DEFAULT_HEARTBEAT_PROMPT =
	"请根据 HEARTBEAT.md（若存在）或你的当前目标，简要汇报思考与进展；不要复述旧对话内容。若无事需汇报则回复 HEARTBEAT_OK.";
/** 无事时模型回复的 token；若回复仅含此 token 或尾部/首部为此且其余 ≤ ackMaxChars 则不下发（与 OpenClaw 一致） */
const HEARTBEAT_OK = "HEARTBEAT_OK";
const HEARTBEAT_ACK_MAX_CHARS = 300;
const HEARTBEAT_MD_FILENAME = "HEARTBEAT.md";

const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function request(ws: WebSocket, method: string, params?: Record<string, unknown>): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const id = `req-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
		if (ws.readyState !== 1) {
			reject(new Error("Gateway not connected"));
			return;
		}
		pending.set(id, { resolve, reject });
		ws.send(JSON.stringify({ method, params, id }));
		setTimeout(() => {
			if (pending.delete(id)) reject(new Error("Gateway request timeout"));
		}, 120_000);
	});
}

/** 供 message_skill、sessions_skill 调用的 Gateway RPC：通过当前 WebSocket 发请求并返回 payload */
function createGatewayInvoke(wsRef: WebSocket): (method: string, params?: Record<string, unknown>) => Promise<unknown> {
	return (method: string, params?: Record<string, unknown>) => request(wsRef, method, params ?? {});
}

/** Gateway 下发的 initialMessages 与 agent-core AgentMessage 的转换（与 Gateway session-transcript 一致） */
function wireToAgentMessages(
	wire: Array<{
		role: string;
		content?: string;
		toolCalls?: Array<{ id?: string; name: string; arguments?: string }>;
		toolCallId?: string;
		isError?: boolean;
	}>,
): AgentMessage[] {
	return wire.map((m) => {
		const id = createId();
		const content = (m.content ?? "").trim() || " ";
		if (m.role === "toolResult") {
			return {
				id,
				role: "toolResult" as const,
				content: [{ type: "text" as const, text: content }],
				timestamp: Date.now(),
				toolCallId: m.toolCallId ?? id,
				isError: m.isError ?? false,
			};
		}
		if (m.role === "assistant") {
			const toolCalls = m.toolCalls?.map((tc, i) => ({
				id: tc.id ?? `tc-${i}`,
				name: tc.name,
				arguments: tc.arguments,
			}));
			return {
				id,
				role: "assistant" as const,
				content: [{ type: "text" as const, text: content }],
				timestamp: Date.now(),
				...(toolCalls?.length && { toolCalls }),
			};
		}
		if (m.role === "system") {
			return {
				id,
				role: "system" as const,
				content: [{ type: "text" as const, text: content }],
				timestamp: Date.now(),
			};
		}
		return {
			id,
			role: "user" as const,
			content: [{ type: "text" as const, text: content }],
			timestamp: Date.now(),
		};
	});
}

/** 与 Gateway StoredMessage 一致的 wire 格式，用于把本轮完整消息链写回 transcript */
export type TurnMessageWire = {
	role: "user" | "assistant" | "system" | "toolResult";
	content?: string;
	toolCalls?: Array<{ id: string; name: string; arguments?: string }>;
	toolCallId?: string;
	isError?: boolean;
};

function agentMessagesToTurnWire(messages: AgentMessage[]): TurnMessageWire[] {
	return messages.map((m) => {
		const text =
			m.content?.find((c) => (c as { type?: string }).type === "text") &&
			(m.content as { type: "text"; text: string }[])[0]?.text;
		const content = typeof text === "string" ? text : "";
		if (m.role === "toolResult") {
			return {
				role: "toolResult" as const,
				content,
				toolCallId: m.toolCallId,
				isError: m.isError,
			};
		}
		if (m.role === "assistant") {
			return {
				role: "assistant" as const,
				content,
				...(m.toolCalls?.length && { toolCalls: m.toolCalls }),
			};
		}
		if (m.role === "system") {
			return { role: "system" as const, content };
		}
		return { role: "user" as const, content };
	});
}

async function runOneTurn(
	message: string,
	initialMessagesWire?: Array<{
		role: string;
		content?: string;
		toolCalls?: Array<{ id?: string; name: string; arguments?: string }>;
		toolCallId?: string;
		isError?: boolean;
	}>,
): Promise<{
	text: string;
	toolCalls?: Array<{ name: string; arguments?: string }>;
	/** 本轮完整消息链（含 user、assistant 的 tool_calls、tool_result、最终 assistant），供 Gateway 写入 transcript */
	turnMessages?: TurnMessageWire[];
}> {
	const gatewayInvoke = createGatewayInvoke(ws);
	const session = await buildSessionFromU(rootDir, { agentDir, gatewayInvoke });
	const initialMessages =
		Array.isArray(initialMessagesWire) && initialMessagesWire.length > 0
			? wireToAgentMessages(initialMessagesWire)
			: undefined;
	const initialLen = initialMessages?.length ?? 0;
	const { state, config, streamFn } = createAgentContextFromU(session, { initialMessages });
	const result = await runAgentTurnWithTools(state, config, streamFn, message, session.executeTool);
	const newMessages = result.state.messages.slice(initialLen);
	const turnMessages = newMessages.length > 0 ? agentMessagesToTurnWire(newMessages) : undefined;
	return {
		text: result.text,
		toolCalls: result.toolCalls?.map((t) => ({ name: t.name, arguments: t.arguments })),
		turnMessages,
	};
}

/** 从首尾剥离 HEARTBEAT_OK；若剥离后内容 ≤ ackMaxChars 则视为「仅 OK」不下发（与 OpenClaw 一致）。 */
function stripHeartbeatOk(raw: string, ackMaxChars: number): { shouldSkip: boolean; text: string } {
	let text = raw.trim();
	if (!text) return { shouldSkip: true, text: "" };
	const token = HEARTBEAT_OK;
	const lower = text.toLowerCase();
	const tokenLower = token.toLowerCase();
	for (;;) {
		const t = text.trimStart();
		if (t.toLowerCase().startsWith(tokenLower)) {
			text = t.slice(token.length).trimStart();
			continue;
		}
		break;
	}
	for (;;) {
		const t = text.trimEnd();
		if (t.toLowerCase().endsWith(tokenLower)) {
			text = t.slice(0, -token.length).trimEnd();
			continue;
		}
		break;
	}
	text = text.trim();
	const shouldSkip = text.length <= ackMaxChars;
	return { shouldSkip, text };
}

/** HEARTBEAT.md 仅空白/标题/空列表项则视为空，可跳过当次心跳以省 API（与 OpenClaw 一致）。 */
function isHeartbeatContentEffectivelyEmpty(content: string): boolean {
	const lines = content.split("\n");
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		if (/^#+(\s|$)/.test(trimmed)) continue;
		if (/^[-*+]\s*(\[[\sXx]?\]\s*)?$/.test(trimmed)) continue;
		return false;
	}
	return true;
}

/**
 * 活动时段：未配置则始终在时段内（与 OpenClaw heartbeat.activeHours 对齐）。
 * 环境变量：HEARTBEAT_ACTIVE_HOURS_START / END（HH:MM 24h），HEARTBEAT_ACTIVE_HOURS_TZ（IANA 或 "local"）。
 */
function isWithinActiveHours(nowMs: number): boolean {
	const start = process.env.HEARTBEAT_ACTIVE_HOURS_START?.trim();
	const end = process.env.HEARTBEAT_ACTIVE_HOURS_END?.trim();
	const tz = process.env.HEARTBEAT_ACTIVE_HOURS_TZ?.trim() || "local";
	if (!start || !end) return true;
	const formatter = new Intl.DateTimeFormat("en-CA", {
		timeZone: tz === "local" ? undefined : tz,
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	});
	const parts = formatter.formatToParts(new Date(nowMs));
	const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
	const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
	const currentMin = parseInt(hour, 10) * 60 + parseInt(minute, 10);
	const [startH, startM] = start.split(":").map((s) => parseInt(s, 10));
	const [endH, endM] = end.split(":").map((s) => parseInt(s, 10));
	const startMin = (startH ?? 0) * 60 + (startM ?? 0);
	let endMin = (endH ?? 24) * 60 + (endM ?? 0);
	if (endMin <= startMin) endMin += 24 * 60;
	return currentMin >= startMin && currentMin < endMin;
}

/** 连接成功后确保 cron store 中存在 Heartbeat 任务（不存在则创建，默认禁用）；与 OpenClaw 语义对齐。 */
async function ensureHeartbeatJob(storePath: string): Promise<void> {
	const store = new CronStore(storePath);
	const jobs = await store.list({ includeDisabled: true });
	if (jobs.some((j) => j.name === HEARTBEAT_JOB_NAME)) return;
	await store.add({
		name: HEARTBEAT_JOB_NAME,
		description: "Periodic learning/report (heartbeat). Set deliver to push to a connector.",
		enabled: true,
		schedule: { kind: "every", everyMs: HEARTBEAT_EVERY_MS },
		payload: { kind: "agentTurn", message: DEFAULT_HEARTBEAT_PROMPT },
	});
	console.log(
		"[heartbeat] default job added (enabled: true). Customize in HEARTBEAT.md or .first_paramecium/cron/jobs.json.",
	);
}

const ws = new WebSocket(GATEWAY_URL);

ws.on("open", () => {
	const params: Record<string, unknown> = {
		role: "agent",
		agentId: AGENT_ID,
		deviceId: DEVICE_ID,
	};
	if (TOKEN) params.token = TOKEN;
	if (PASSWORD) params.password = PASSWORD;
	ws.send(JSON.stringify({ method: "connect", params, id: "connect-1" }));
});

ws.on("message", async (data: Buffer | ArrayBuffer) => {
	let msg: { id?: string; ok?: boolean; payload?: unknown; error?: { message?: string }; event?: string };
	try {
		msg = JSON.parse((typeof data === "string" ? data : (data as Buffer).toString("utf8")) as string) as typeof msg;
	} catch {
		return;
	}
	if (msg.id !== undefined && pending.has(msg.id)) {
		const { resolve: res, reject: rej } = pending.get(msg.id)!;
		pending.delete(msg.id);
		if (msg.ok === false) rej(new Error(msg.error?.message ?? "Gateway error"));
		else res(msg.payload);
		return;
	}
	const payload = msg.payload as
		| {
				id?: string;
				__agent?: boolean;
				message?: string;
				initialMessages?: Array<{
					role: string;
					content?: string;
					toolCalls?: Array<{ id?: string; name: string; arguments?: string }>;
					toolCallId?: string;
					isError?: boolean;
				}>;
		  }
		| undefined;
	if (msg.event === "node.invoke.request" && payload?.__agent === true && typeof payload.message === "string") {
		const invokeId = payload.id;
		const prevMemory = process.env.MEMORY_WORKSPACE;
		const prevCron = process.env.CRON_STORE;
		process.env.MEMORY_WORKSPACE = agentDir;
		process.env.CRON_STORE = cronStorePath;
		try {
			const result = await runOneTurn(payload.message, payload.initialMessages);
			ws.send(
				JSON.stringify({
					method: "node.invoke.result",
					params: { id: invokeId, result },
					id: `result-${invokeId}`,
				}),
			);
		} catch (err) {
			ws.send(
				JSON.stringify({
					method: "node.invoke.result",
					params: { id: invokeId, result: { text: `[error] ${(err as Error).message}`, toolCalls: [] } },
					id: `result-${invokeId}`,
				}),
			);
		} finally {
			if (prevMemory !== undefined) process.env.MEMORY_WORKSPACE = prevMemory;
			else delete process.env.MEMORY_WORKSPACE;
			if (prevCron !== undefined) process.env.CRON_STORE = prevCron;
			else delete process.env.CRON_STORE;
		}
	}
	if (msg.event === "agent.file.upload" && payload && typeof payload.id === "string") {
		const uploadPayload = payload as { id: string; filename?: string; content?: string };
		await handleFileUpload(
			{ id: uploadPayload.id, filename: uploadPayload.filename, content: uploadPayload.content },
			(obj) => ws.send(JSON.stringify(obj)),
		);
	}
});

ws.on("close", () => {
	console.error("与 Gateway 断开");
	process.exit(0);
});
ws.on("error", (err) => {
	console.error("WebSocket 错误:", err.message);
	process.exit(1);
});

const onFirstMessage = async (data: Buffer | ArrayBuffer) => {
	let msg: { id?: string; ok?: boolean; error?: { message?: string } };
	try {
		msg = JSON.parse((typeof data === "string" ? data : (data as Buffer).toString("utf8")) as string) as typeof msg;
	} catch {
		return;
	}
	if (msg.id === "connect-1") {
		ws.off("message", onFirstMessage);
		if (msg.ok !== true) {
			console.error("Connect failed:", msg.error?.message ?? "unknown");
			process.exit(1);
		}
		console.log("已连接并注册，等待派发…");
		try {
			await ensureHeartbeatJob(cronStorePath);
		} catch (e) {
			console.warn("[heartbeat] ensureHeartbeatJob failed:", (e as Error).message);
		}
		runScheduler(cronStorePath, {
			log: {
				info: (m: string, d?: Record<string, unknown>) => console.log(`[cron] ${m}`, d ?? ""),
				warn: (m: string, d?: Record<string, unknown>) => console.warn(`[cron] ${m}`, d ?? ""),
			},
			shouldRunJob: (job, nowMs) => job.name !== HEARTBEAT_JOB_NAME || isWithinActiveHours(nowMs),
			onJobDue: async (job: CronJob) => {
				if (job.payload.kind !== "agentTurn") return;
				const isHeartbeat = job.name === HEARTBEAT_JOB_NAME;
				if (isHeartbeat) {
					const heartbeatPath = path.join(agentDir, HEARTBEAT_MD_FILENAME);
					try {
						const content = await fs.readFile(heartbeatPath, "utf-8");
						if (isHeartbeatContentEffectivelyEmpty(content)) return;
					} catch {
						// 文件不存在则照常跑
					}
				}
				const prevM = process.env.MEMORY_WORKSPACE;
				const prevC = process.env.CRON_STORE;
				process.env.MEMORY_WORKSPACE = agentDir;
				process.env.CRON_STORE = cronStorePath;
				try {
					const result = await runOneTurn((job.payload as { message?: string }).message ?? "");
					let text = result?.text ?? "";
					if (isHeartbeat) {
						const { shouldSkip, text: stripped } = stripHeartbeatOk(text, HEARTBEAT_ACK_MAX_CHARS);
						if (shouldSkip) text = "";
						else text = stripped;
					}
					if (job.deliver?.connectorId && job.deliver?.chatId && text) {
						await request(ws, "connector.message.push", {
							connectorId: job.deliver.connectorId,
							chatId: job.deliver.chatId,
							text,
						});
					}
					if (isHeartbeat) {
						try {
							await request(ws, "agent.heartbeat", {});
						} catch {
							// 忽略上报失败，不影响任务完成
						}
					}
				} catch (e) {
					const errMsg = (e as Error).message;
					console.warn("[cron] onJobDue failed:", errMsg);
					// Heartbeat 失败时仍上报 agent.heartbeat，避免因 LLM/API 报错导致节点被误判为离线
					if (isHeartbeat) {
						const isLikelyLlmError =
							/^\d{3}\b/.test(errMsg) ||
							/Extra data|Connection error|timeout|ECONNREFUSED|ETIMEDOUT/i.test(errMsg);
						if (isLikelyLlmError) {
							console.warn(
								"[cron] 提示: 多为 LLM API 异常（如 400/Extra data 常为代理或服务端 JSON 解析失败），请检查 BIANXIE_BASE_URL、网络或代理。",
							);
						}
						try {
							await request(ws, "agent.heartbeat", {});
						} catch {
							// 忽略上报失败
						}
					}
				} finally {
					if (prevM !== undefined) process.env.MEMORY_WORKSPACE = prevM;
					else delete process.env.MEMORY_WORKSPACE;
					if (prevC !== undefined) process.env.CRON_STORE = prevC;
					else delete process.env.CRON_STORE;
				}
			},
		}).catch((e) => console.error("[cron] scheduler fatal:", (e as Error).message));
	}
};
ws.once("message", onFirstMessage);

console.log(`Agent: agentId=${AGENT_ID}, agentDir=${agentDir}, gateway=${GATEWAY_URL}`);
