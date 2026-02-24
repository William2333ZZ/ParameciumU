/**
 * Sessions skill: sessions_list, sessions_preview, sessions_send.
 * Requires gatewayInvoke for sessions.list, sessions.preview, chat.send.
 */

import type { AgentTool } from "@monou/agent-core";

export const tools: AgentTool[] = [
	{
		name: "sessions_list",
		description: "列出所有会话（sessionKey、sessionId、updatedAt、displayName 等）。",
		parameters: { type: "object", properties: {}, required: [] },
	},
	{
		name: "sessions_preview",
		description: "简要列出会话（sessionKey、sessionId、updatedAt、displayName）。",
		parameters: { type: "object", properties: {}, required: [] },
	},
	{
		name: "sessions_send",
		description: "向指定 sessionKey 发送一条消息并触发该会话的 agent 回复。",
		parameters: {
			type: "object",
			properties: {
				sessionKey: { type: "string", description: "会话 key，如 main 或 connector:feishu:chat:xxx" },
				message: { type: "string", description: "要发送的消息内容" },
			},
			required: ["sessionKey", "message"],
		},
	},
];

export type GatewayInvoke = (method: string, params: Record<string, unknown>) => Promise<unknown>;

export async function executeTool(
	name: string,
	args: Record<string, unknown>,
	gatewayInvoke?: GatewayInvoke,
): Promise<{ content: string; isError?: boolean }> {
	if (!gatewayInvoke) {
		return { content: "sessions tools require Gateway (not available in this run).", isError: true };
	}
	try {
		if (name === "sessions_list") {
			const result = await gatewayInvoke("sessions.list", {});
			const payload = result && typeof result === "object" && "sessions" in result
				? (result as { sessions: unknown[] }).sessions
				: result;
			return { content: JSON.stringify(payload, null, 2) };
		}
		if (name === "sessions_preview") {
			const result = await gatewayInvoke("sessions.preview", {});
			const payload = result && typeof result === "object" && "sessions" in result
				? (result as { sessions: unknown[] }).sessions
				: result;
			return { content: JSON.stringify(payload, null, 2) };
		}
		if (name === "sessions_send") {
			const sessionKey = String(args.sessionKey ?? "").trim();
			const message = String(args.message ?? "").trim();
			if (!sessionKey || !message) {
				return { content: "sessionKey and message are required", isError: true };
			}
			const result = await gatewayInvoke("chat.send", { sessionKey, message });
			return { content: JSON.stringify(result, null, 2) };
		}
		return { content: `Unknown tool: ${name}`, isError: true };
	} catch (e) {
		return { content: e instanceof Error ? e.message : String(e), isError: true };
	}
}
