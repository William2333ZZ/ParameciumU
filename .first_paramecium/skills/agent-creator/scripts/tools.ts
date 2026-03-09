import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentTool } from "@monou/agent-core";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const tools: AgentTool[] = [
	{
		name: "agent_create_and_connect",
		description:
			"创建并连接一个新 agent。优先使用 agentId；若未提供会自动生成。可选 gatewayUrl、skills（空格分隔，如 'base_skill memory cron'）。",
		parameters: {
			type: "object",
			properties: {
				agentId: { type: "string", description: "新 agent 的唯一 ID（目录名），建议小写英文+中划线。可省略，系统会自动生成。" },
				agentName: { type: "string", description: "可选，业务名称/中文名称；当未传 agentId 时用于生成 ID。" },
				gatewayUrl: { type: "string", description: "可选，默认 ws://127.0.0.1:9347。" },
				skills: { type: "string", description: "可选，空格分隔技能名；默认 base_skill memory cron。" },
			},
			required: [],
		},
	},
];

function normalizeAgentId(raw: string): string {
	const cleaned = raw
		.trim()
		.replace(/[（(].*$/, "")
		.replace(/^agentId\s*=\s*/i, "")
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^[-]+|[-]+$/g, "");
	return cleaned;
}

function autoAgentId(agentName: string): string {
	const fromName = normalizeAgentId(agentName);
	if (fromName) return fromName;
	return `agent-${Date.now().toString(36)}`;
}

export async function executeTool(
	name: string,
	args: Record<string, unknown>,
): Promise<{ content: string; isError?: boolean }> {
	try {
		if (name !== "agent_create_and_connect") {
			return { content: `Unknown tool: ${name}`, isError: true };
		}
		const rawId = String(args?.agentId ?? "");
		const rawName = String(args?.agentName ?? "");
		const agentId = normalizeAgentId(rawId) || autoAgentId(rawName);
		const gatewayUrl = String(args?.gatewayUrl ?? "").trim();
		const skills = String(args?.skills ?? "").trim();

		const scriptPath = resolve(__dirname, "create-and-connect.sh");
		const env: NodeJS.ProcessEnv = {
			...process.env,
			AGENT_ID: agentId,
			...(gatewayUrl && { GATEWAY_URL: gatewayUrl }),
			...(skills && { SKILLS: skills }),
		};
		const out = execSync(`bash "${scriptPath}"`, {
			encoding: "utf-8",
			maxBuffer: 4 * 1024 * 1024,
			cwd: process.cwd(),
			env,
		});
		return { content: out?.trim() || `agent ${agentId} created and connecting` };
	} catch (e) {
		return { content: e instanceof Error ? e.message : String(e), isError: true };
	}
}

