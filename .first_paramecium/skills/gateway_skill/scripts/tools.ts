/**
 * Gateway skill: query connected agents, nodes, per-agent cron and skills.
 * Requires gatewayInvoke (agents.list, node.list, cron.list, skills.status).
 */

import type { AgentTool } from "@monou/agent-core";

export const tools: AgentTool[] = [
  {
    name: "gateway_agents_list",
    description: "列出当前连到 Gateway 的所有 Agent（agentId、deviceId、online、lastHeartbeatAt）。",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "gateway_nodes_list",
    description: "列出 Gateway 拓扑：节点（nodeId、deviceId、其下 agents）与接入（connectors，如飞书）。",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "gateway_cron_list",
    description: "列出某 Agent 的定时任务（cron）。可选 agentId，默认 .u。返回 name、schedule、nextRunAtMs、enabled。",
    parameters: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "Agent 标识，默认 .u" },
        includeDisabled: { type: "boolean", description: "是否包含已禁用的任务，默认 true" },
      },
      required: [],
    },
  },
  {
    name: "gateway_skills_status",
    description: "查询某 Agent 的技能/能力（能做什么）。可选 agentId，默认 .u。",
    parameters: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "Agent 标识，默认 .u" },
      },
      required: [],
    },
  },
  {
    name: "gateway_agent_send_to_session",
    description: "把一条消息发到指定 Agent 的 session，由该 Agent 在该 session 内直接回复（直接对话）。用于委托：先 gateway_agents_list 查可用 Agent，再发消息到其主 session；定时任务与工具由对方用自己的 cron/技能完成。不传 sessionKey 时用对方主 session（agent:<targetAgentId>:main）。",
    parameters: {
      type: "object",
      properties: {
        targetAgentId: { type: "string", description: "目标 Agent 的 agentId（必填）" },
        message: { type: "string", description: "要发送的消息内容（必填）" },
        sessionKey: { type: "string", description: "目标 sessionKey，不传则用 agent:<targetAgentId>:main" },
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
    return { content: "Gateway 工具需要连接 Gateway（当前运行环境未提供）。", isError: true };
  }
  try {
    if (name === "gateway_agents_list") {
      const result = await gatewayInvoke("agents.list", {});
      const payload = result && typeof result === "object" && "agents" in result
        ? (result as { agents: unknown[] }).agents
        : result;
      return { content: JSON.stringify(payload, null, 2) };
    }
    if (name === "gateway_nodes_list") {
      const result = await gatewayInvoke("node.list", {});
      return { content: JSON.stringify(result, null, 2) };
    }
    if (name === "gateway_cron_list") {
      const agentId = (args?.agentId as string)?.trim() || ".u";
      const includeDisabled = args?.includeDisabled !== false;
      const result = await gatewayInvoke("cron.list", { agentId, includeDisabled });
      const payload = result && typeof result === "object" && "jobs" in result
        ? (result as { jobs: unknown[] }).jobs
        : result;
      return { content: JSON.stringify(payload, null, 2) };
    }
    if (name === "gateway_skills_status") {
      const agentId = (args?.agentId as string)?.trim() || ".u";
      const result = await gatewayInvoke("skills.status", { agentId });
      return { content: JSON.stringify(result, null, 2) };
    }
    if (name === "gateway_agent_send_to_session") {
      const targetAgentId = (args?.targetAgentId as string)?.trim();
      const message = (args?.message as string)?.trim();
      if (!targetAgentId || !message) {
        return { content: "gateway_agent_send_to_session 需要 targetAgentId 和 message", isError: true };
      }
      const sessionKey =
        (args?.sessionKey as string)?.trim() || `agent:${targetAgentId}:main`;
      const result = await gatewayInvoke("chat.send", {
        agentId: targetAgentId,
        sessionKey,
        message,
      });
      const payload = result && typeof result === "object" ? result : { result };
      return { content: JSON.stringify(payload, null, 2) };
    }
    return { content: `Unknown tool: ${name}`, isError: true };
  } catch (e) {
    return { content: e instanceof Error ? e.message : String(e), isError: true };
  }
}
