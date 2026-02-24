/**
 * Message skill: send_message(connectorId, chatId, text).
 * Requires gatewayInvoke("connector.message.push", { connectorId, chatId, text }) when running with Gateway.
 */

import type { AgentTool } from "@monou/agent-core";

export const tools: AgentTool[] = [
	{
		name: "send_message",
		description: "向指定渠道会话发送一条消息（需要 Gateway 与对应 connector 在线）。",
		parameters: {
			type: "object",
			properties: {
				connectorId: { type: "string", description: "连接器 ID（如 feishu-app 的 connectorId）" },
				chatId: { type: "string", description: "会话/群/私聊 ID" },
				text: { type: "string", description: "要发送的文本" },
				channelId: { type: "string", description: "可选，子频道 ID" },
			},
			required: ["connectorId", "chatId", "text"],
		},
	},
];

export type GatewayInvoke = (method: string, params: Record<string, unknown>) => Promise<unknown>;

export async function executeTool(
	name: string,
	args: Record<string, unknown>,
	gatewayInvoke?: GatewayInvoke,
): Promise<{ content: string; isError?: boolean }> {
	if (name !== "send_message") return { content: `Unknown tool: ${name}`, isError: true };
	if (!gatewayInvoke) return { content: "send_message requires Gateway (not available in this run).", isError: true };
	const connectorId = String(args.connectorId ?? "").trim();
	const chatId = String(args.chatId ?? "").trim();
	const text = String(args.text ?? "").trim();
	if (!connectorId || !chatId) return { content: "connectorId and chatId are required", isError: true };
	try {
		const result = await gatewayInvoke("connector.message.push", {
			connectorId,
			chatId,
			text: text || "(无文本)",
			...(typeof args.channelId === "string" && args.channelId.trim() && { channelId: args.channelId.trim() }),
		});
		const ok = result && typeof result === "object" && "pushed" in result && (result as { pushed?: boolean }).pushed === true;
		return ok ? { content: "Message sent." } : { content: String(JSON.stringify(result)), isError: true };
	} catch (e) {
		return { content: e instanceof Error ? e.message : String(e), isError: true };
	}
}
