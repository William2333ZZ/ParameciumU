---
name: gateway_skill
description: Query the connected Gateway for linked agents, nodes, each agent's cron jobs and skills. Use when the user asks who is connected, what agents can do, what scheduled tasks exist, or to discover topology (nodes/connectors). Requires Gateway connection.
---

# Gateway Skill

Query the monoU Gateway that this agent is connected to: list linked agents, nodes/connectors, per-agent cron jobs, and per-agent skills (what each agent can do).

## Tools

| Tool | Use |
|------|-----|
| **gateway_agents_list** | List all agents currently connected to the Gateway (agentId, deviceId, online, lastHeartbeatAt). |
| **gateway_nodes_list** | List nodes and connectors (topology): each node has deviceId and its agents; connectors are L1 entries (e.g. Feishu). |
| **gateway_cron_list** | List cron/scheduled tasks for an agent. Pass optional `agentId` (default .u). Returns jobs with name, schedule, nextRunAtMs, enabled. |
| **gateway_skills_status** | Get skills/capabilities of an agent. Pass optional `agentId` (default .u). Returns skill names and summaries (what the agent can do). |
| **gateway_agent_send_to_session** | 委托：把一条消息发到指定 Agent 的 session，由该 Agent 在该 session 内直接回复（直接对话）。必填 `targetAgentId`、`message`；可选 `sessionKey`（不传则用对方主 session）。定时任务与工具由对方用自己的 cron/技能完成。 |

## When to use

- **"有哪些 agent 连着？" / "谁在线？"** → `gateway_agents_list`
- **"每个 agent 能做什么？" / "xxx 有什么能力？"** → `gateway_agents_list` then `gateway_skills_status(agentId)` for each, or one agent.
- **"定时任务有哪些？" / "xxx 的 cron 是什么？"** → `gateway_cron_list(agentId)`
- **"拓扑/节点有哪些？" / "飞书接入了吗？"** → `gateway_nodes_list`
- **委托 / 直接对话**：「让某 agent 做某事」→ 先 `gateway_agents_list` 确认对方在线，再 `gateway_agent_send_to_session(targetAgentId, message)` 把话发到对方 session；对方在自己 session 里回复，定时任务与工具由对方用自己的 cron/技能完成。
- **Orchestration**: Before delegating or suggesting "让某 agent 执行某任务", use these tools to see who is connected and what they can do.
- **Troubleshooting**: "为什么收不到推送？" → check connectors in `gateway_nodes_list`; "某 agent 的定时有没有跑？" → `gateway_cron_list(agentId)`.

## Guidelines

- Requires Gateway: if not connected (e.g. running with `npm run u` without Gateway), tools return an error.
- Prefer `gateway_agents_list` first when the user asks about "agents" or "谁", then `gateway_skills_status` or `gateway_cron_list` for details.
- For "每个 agent 能做什么", call `gateway_skills_status` once per agentId from the agents list, or ask the user which agent they care about.

## 更多场景

详见 [references/scenarios.md](references/scenarios.md)：发现与概览、能力查询、定时任务、编排与建议、排查运维、组合用法等。
