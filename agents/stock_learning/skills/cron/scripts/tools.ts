/**
 * Cron skill tools: cron_status, cron_list, cron_add, cron_update, cron_remove, cron_run, cron_start_scheduler.
 * Uses @monou/cron only; no openclaw dependency.
 */

import { spawn } from "node:child_process";
import type { AgentTool } from "@monou/agent-core";
import type { CronSchedule } from "@monou/cron";
import { CronStore, getDefaultStorePath, getSchedulerCliPath } from "@monou/cron";

function getStorePath(): string {
	return getDefaultStorePath(process.cwd());
}

/** Normalize schedule from LLM-friendly shapes to CronSchedule. */
function normalizeSchedule(raw: Record<string, unknown>): CronSchedule {
	const kind = String(raw.kind ?? "").trim().toLowerCase();
	if (kind === "at" || raw.at) {
		const at = typeof raw.at === "string" ? raw.at.trim() : "";
		if (!at) throw new Error("schedule.at is required for kind=at");
		return { kind: "at", at };
	}
	if (kind === "every" || typeof raw.everyMs === "number") {
		const everyMs = Number(raw.everyMs);
		if (!Number.isFinite(everyMs) || everyMs < 1)
			throw new Error("schedule.everyMs is required (positive number) for kind=every");
		return { kind: "every", everyMs: Math.floor(everyMs), anchorMs: raw.anchorMs as number | undefined };
	}
	if (kind === "cron" || raw.expr || raw.cron) {
		const expr = typeof raw.expr === "string" ? raw.expr.trim() : typeof raw.cron === "string" ? raw.cron.trim() : "";
		if (!expr) throw new Error("schedule.expr or schedule.cron is required for kind=cron");
		const tz = typeof raw.tz === "string" ? raw.tz.trim() || undefined : undefined;
		return { kind: "cron", expr, tz };
	}
	throw new Error("schedule must be { kind: 'at', at } | { kind: 'every', everyMs } | { kind: 'cron', expr, tz? }");
}

function getStore(): CronStore {
	return new CronStore(getStorePath());
}

export const tools: AgentTool[] = [
	{
		name: "cron_status",
		description: "返回定时任务存储路径、任务数、下次唤醒时间。",
		parameters: {
			type: "object",
			properties: {},
			required: [],
		},
	},
	{
		name: "cron_list",
		description: "列出定时任务（按下次运行时间排序）。可选包含已禁用的任务。",
		parameters: {
			type: "object",
			properties: {
				includeDisabled: {
					type: "boolean",
					description: "为 true 时包含已禁用的任务",
				},
			},
			required: [],
		},
	},
	{
		name: "cron_add",
		description:
			"创建定时任务。schedule: at(一次性) / every(间隔毫秒) / cron(表达式+可选tz)。payload: systemEvent(text) 或 agentTurn(message)。",
		parameters: {
			type: "object",
			properties: {
				name: { type: "string", description: "任务名称（必填）" },
				description: { type: "string", description: "任务描述" },
				schedule: {
					type: "object",
					description:
						"调度：{ kind: 'at', at: 'ISO时间' } | { kind: 'every', everyMs: number } | { kind: 'cron', expr: string, tz?: string }",
				},
				payload: {
					type: "object",
					description:
						"负载：{ kind: 'systemEvent', text: string } 或 { kind: 'agentTurn', message: string }",
				},
				enabled: { type: "boolean", description: "是否启用，默认 true" },
				deleteAfterRun: { type: "boolean", description: "at 任务跑完后是否删除" },
				deliver: {
					type: "object",
					description:
						"执行完成后推送到某 Connector 会话，仅 agentTurn 有效。{ connectorId, chatId }，如 { connectorId: 'feishu', chatId: 'oc_xxx' }",
					properties: {
						connectorId: { type: "string", description: "连接器 ID，如 feishu" },
						chatId: { type: "string", description: "目标会话/群 ID，如飞书群 chat_id" },
					},
				},
			},
			required: ["name", "schedule", "payload"],
		},
	},
	{
		name: "cron_update",
		description: "更新定时任务。",
		parameters: {
			type: "object",
			properties: {
				id: { type: "string", description: "任务 id（必填）" },
				patch: {
					type: "object",
					description: "要更新的字段：name、description、enabled、schedule、payload、deleteAfterRun 等",
				},
			},
			required: ["id"],
		},
	},
	{
		name: "cron_remove",
		description: "删除定时任务。",
		parameters: {
			type: "object",
			properties: {
				id: { type: "string", description: "任务 id（必填）" },
			},
			required: ["id"],
		},
	},
	{
		name: "cron_run",
		description: "立即运行一次任务（更新运行时间与下次运行时间，不执行 agent）。",
		parameters: {
			type: "object",
			properties: {
				id: { type: "string", description: "任务 id（必填）" },
				mode: {
					type: "string",
					description: "force 或 due，默认 force",
					enum: ["force", "due"],
				},
			},
			required: ["id"],
		},
	},
	{
		name: "cron_start_scheduler",
		description:
			"启动常驻定时调度器（后台进程）。启动后会按 .u/cron/jobs.json 中的任务到点自动更新状态；进程会持续运行直到被用户终止。用户说「启动定时器」「开定时调度」时可调用。",
		parameters: {
			type: "object",
			properties: {},
			required: [],
		},
	},
];

export async function executeTool(
	name: string,
	args: Record<string, unknown>,
): Promise<{ content: string; isError?: boolean }> {
	const store = getStore();
	try {
		if (name === "cron_status") {
			const status = await store.status();
			return { content: JSON.stringify(status) };
		}
		if (name === "cron_list") {
			const includeDisabled = args?.includeDisabled === true;
			const jobs = await store.list({ includeDisabled });
			return {
				content: JSON.stringify({
					jobs: jobs.map((j) => ({
						id: j.id,
						name: j.name,
						description: j.description,
						enabled: j.enabled,
						schedule: j.schedule,
						payload: j.payload,
						state: j.state,
						createdAtMs: j.createdAtMs,
						updatedAtMs: j.updatedAtMs,
					})),
				}),
			};
		}
		if (name === "cron_add") {
			const nameVal = String(args?.name ?? "").trim();
			if (!nameVal) return { content: "name is required", isError: true };
			const schedule = args?.schedule as Record<string, unknown> | undefined;
			if (!schedule || typeof schedule !== "object")
				return { content: "schedule is required (object)", isError: true };
			const payload = args?.payload as Record<string, unknown> | undefined;
			if (!payload || typeof payload !== "object")
				return { content: "payload is required (object)", isError: true };
			const kind = String(payload.kind ?? "").trim();
			if (kind === "systemEvent") {
				const text = String(payload.text ?? "").trim();
				if (!text) return { content: "payload.text is required for systemEvent", isError: true };
			} else if (kind === "agentTurn") {
				const message = String(payload.message ?? "").trim();
				if (!message)
					return { content: "payload.message is required for agentTurn", isError: true };
			} else {
				return { content: "payload.kind must be systemEvent or agentTurn", isError: true };
			}
			const normalizedSchedule = normalizeSchedule(schedule as Record<string, unknown>);
			const deliver =
				args?.deliver && typeof args.deliver === "object" && args.deliver !== null
					? (() => {
							const d = args.deliver as Record<string, unknown>;
							const cid = typeof d.connectorId === "string" ? d.connectorId.trim() : "";
							const chatId = typeof d.chatId === "string" ? d.chatId.trim() : "";
							if (cid && chatId) return { connectorId: cid, chatId };
							return undefined;
						})()
					: undefined;
			const job = await store.add({
				name: nameVal,
				description:
					typeof args?.description === "string" ? args.description.trim() || undefined : undefined,
				schedule: normalizedSchedule,
				payload: payload as import("@monou/cron").CronPayload,
				enabled: typeof args?.enabled === "boolean" ? args.enabled : true,
				deleteAfterRun:
					typeof args?.deleteAfterRun === "boolean" ? args.deleteAfterRun : undefined,
				deliver,
			});
			return { content: JSON.stringify({ job }) };
		}
		if (name === "cron_update") {
			const id = String(args?.id ?? "").trim();
			if (!id) return { content: "id is required", isError: true };
			const patch = (args?.patch as Record<string, unknown>) ?? {};
			const job = await store.update(id, patch as import("@monou/cron").CronJobPatch);
			return { content: JSON.stringify({ job }) };
		}
		if (name === "cron_remove") {
			const id = String(args?.id ?? "").trim();
			if (!id) return { content: "id is required", isError: true };
			const result = await store.remove(id);
			return { content: JSON.stringify(result) };
		}
		if (name === "cron_run") {
			const id = String(args?.id ?? "").trim();
			if (!id) return { content: "id is required", isError: true };
			const mode = (args?.mode as "force" | "due") ?? "force";
			const result = await store.run(id, mode);
			return { content: JSON.stringify(result) };
		}
		if (name === "cron_start_scheduler") {
			try {
				const cliPath = getSchedulerCliPath();
				const child = spawn(process.execPath, [cliPath], {
					cwd: process.cwd(),
					detached: true,
					stdio: "ignore",
				});
				child.unref();
				return {
					content: JSON.stringify({
						ok: true,
						message: "常驻定时调度器已在后台启动，将按 .u/cron/jobs.json 中的任务到点执行。关闭终端或结束进程可停止调度器。",
					}),
				};
			} catch (e) {
				const message = e instanceof Error ? e.message : String(e);
				return { content: JSON.stringify({ ok: false, error: message }), isError: true };
			}
		}
		return { content: `Unknown tool: ${name}`, isError: true };
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		return { content: message, isError: true };
	}
}
