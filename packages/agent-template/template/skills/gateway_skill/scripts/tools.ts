/**
 * Gateway skill: gateway_agents_list, gateway_agent_send_to_session.
 * 委托到对方 session：由目标 agent 在目标 session 内直接回复。
 * Requires gatewayInvoke (agents.list, chat.send).
 */

import type { AgentTool } from "@monou/agent-core";

export const tools: AgentTool[] = [
  {
    name: "gateway_agents_list",
    description: "列出当前已连接 Gateway 的 agent（agentId、online 等），用于决定委托给谁。",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "gateway_agent_send_to_session",
    description: "向指定 agent 的 session 发送一条消息；该 agent 会在目标 session 内执行并回复。不传 sessionKey 时使用对方主会话 agent:<targetAgentId>:main。",
    parameters: {
      type: "object",
      properties: {
        targetAgentId: { type: "string", description: "目标 agent 的 id（必填）" },
        message: { type: "string", description: "要发送的消息内容（必填）" },
        sessionKey: { type: "string", description: "可选，目标 sessionKey；不传则用 agent:<targetAgentId>:main" },
      },
      required: ["targetAgentId", "message"],
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
    return { content: "gateway tools require Gateway (not available in this run).", isError: true };
  }
  try {
    if (name === "gateway_agents_list") {
      const result = await gatewayInvoke("agents.list", {});
      const payload =
        result && typeof result === "object" && "agents" in result
          ? (result as { agents: unknown[] }).agents
          : result;
      return { content: JSON.stringify(payload, null, 2) };
    }
    if (name === "gateway_agent_send_to_session") {
      const targetAgentId = String(args.targetAgentId ?? "").trim();
      const message = String(args.message ?? "").trim();
      const sessionKeyRaw = args.sessionKey != null ? String(args.sessionKey).trim() : "";
      if (!targetAgentId || !message) {
        return { content: "targetAgentId and message are required", isError: true };
      }
      const sessionKey =
        sessionKeyRaw || `agent:${targetAgentId}:main`;
      const result = await gatewayInvoke("chat.send", {
        agentId: targetAgentId,
        sessionKey,
        message,
      });
      return { content: JSON.stringify(result, null, 2) };
    }
    return { content: `Unknown tool: ${name}`, isError: true };
  } catch (e) {
    return { content: e instanceof Error ? e.message : String(e), isError: true };
  }
}
