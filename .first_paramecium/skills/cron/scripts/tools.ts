/**
 * Cron skill tools: cron_status, cron_list, cron_add, cron_update, cron_remove, cron_run.
 *
 * Two payload kinds:
 *   - agentTurn: triggers a full LLM agent turn with payload.message as input.
 *   - systemEvent: no LLM involvement; handled directly by the runtime (heartbeat, process checks, etc.).
 *
 * Execution runs inside the agent process (apps/agent); no separate daemon required.
 */

import type { AgentTool } from "@monou/agent-core";
import { CronStore, getDefaultStorePath } from "@monou/cron";

function getStorePath(): string {
	return getDefaultStorePath(process.cwd());
}

function getStore(): CronStore {
	return new CronStore(getStorePath());
}

export const tools: AgentTool[] = [
	{
		name: "cron_status",
		description:
			"Return the cron store path, total job count, and time until the next scheduled run.",
		parameters: {
			type: "object",
			properties: {},
			required: [],
		},
	},
	{
		name: "cron_list",
		description:
			"List scheduled jobs sorted by next run time. Pass includeDisabled: true to include disabled jobs.",
		parameters: {
			type: "object",
			properties: {
				includeDisabled: {
					type: "boolean",
					description: "Include disabled jobs. Default false.",
				},
			},
			required: [],
		},
	},
	{
		name: "cron_add",
		description:
			"Create a scheduled job. schedule: at (one-shot ISO time) / every (fixed interval ms) / cron (expression + optional tz). payload.kind: 'agentTurn' triggers an LLM turn with payload.message; 'systemEvent' fires without LLM (heartbeat, process checks).",
		parameters: {
			type: "object",
			properties: {
				name: { type: "string", description: "Job name (required)." },
				description: { type: "string", description: "Optional description." },
				schedule: {
					type: "object",
					description:
						"{ kind: 'at', at: 'ISO-datetime' } | { kind: 'every', everyMs: number, anchorMs?: number } | { kind: 'cron', expr: string, tz?: string }",
				},
				payload: {
					type: "object",
					description:
						"{ kind: 'agentTurn', message: string } — LLM runs a turn with this message. OR { kind: 'systemEvent', text: string } — no LLM; runtime handles directly (use for heartbeat, process checks, etc.).",
				},
				enabled: { type: "boolean", description: "Enable job on creation. Default true." },
				deleteAfterRun: {
					type: "boolean",
					description: "Delete after running once. Default true for 'at' jobs.",
				},
			},
			required: ["name", "schedule", "payload"],
		},
	},
	{
		name: "cron_update",
		description: "Update a job by id. Pass patch with any fields to change.",
		parameters: {
			type: "object",
			properties: {
				id: { type: "string", description: "Job id (required)." },
				patch: {
					type: "object",
					description:
						"Fields to update: name, description, enabled, schedule, payload, deleteAfterRun, etc.",
				},
			},
			required: ["id"],
		},
	},
	{
		name: "cron_remove",
		description: "Delete a scheduled job by id.",
		parameters: {
			type: "object",
			properties: {
				id: { type: "string", description: "Job id (required)." },
			},
			required: ["id"],
		},
	},
	{
		name: "cron_run",
		description:
			"Immediately advance a job's timing (updates lastRunAtMs and nextRunAtMs). Does not directly invoke the agent turn — the in-process scheduler handles actual execution on the next tick. mode: 'force' (default) runs regardless of schedule; 'due' only if the job is due.",
		parameters: {
			type: "object",
			properties: {
				id: { type: "string", description: "Job id (required)." },
				mode: {
					type: "string",
					description: "'force' (default) or 'due'.",
					enum: ["force", "due"],
				},
			},
			required: ["id"],
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
				return { content: "payload.kind must be 'agentTurn' or 'systemEvent'", isError: true };
			}
			const job = await store.add({
				name: nameVal,
				description:
					typeof args?.description === "string" ? args.description.trim() || undefined : undefined,
				schedule: schedule as import("@monou/cron").CronSchedule,
				payload: payload as import("@monou/cron").CronPayload,
				enabled: typeof args?.enabled === "boolean" ? args.enabled : true,
				deleteAfterRun:
					typeof args?.deleteAfterRun === "boolean" ? args.deleteAfterRun : undefined,
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
		return { content: `Unknown tool: ${name}`, isError: true };
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		return { content: message, isError: true };
	}
}
