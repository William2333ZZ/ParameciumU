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
    return { content: `Unknown tool: ${name}`, isError: true };
  } catch (e) {
    return { content: e instanceof Error ? e.message : String(e), isError: true };
  }
}
