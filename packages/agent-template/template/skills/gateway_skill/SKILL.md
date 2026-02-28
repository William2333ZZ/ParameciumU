---
name: gateway_skill
description: 委托到其他 Agent：查在线 agent 列表、向指定 agent 的 session 发消息，由对方在该 session 内直接回复。
---

# Gateway Skill（委托到对方 Session）

当需要把一件事交给另一个 agent 时，用本 skill：**把消息发到目标 agent 的 session**，由**该 agent 在那个 session 里直接回复**。用户打开那个 session 就能看到回复。

## Tools

| Tool | 说明 |
|------|------|
| **gateway_agents_list** | 列出当前已连接 Gateway 的 agent（agentId、online 等），用于决定委托给谁。 |
| **gateway_agent_send_to_session** | 向指定 agent 的 session 发送一条消息；该 agent 会在**目标 session** 内执行并回复（回复写入该 session 的 transcript）。 |

## 委托语义

- **gateway_agent_send_to_session(targetAgentId, message, sessionKey?)**：不传 sessionKey 时默认 `agent:<targetAgentId>:main`（对方主会话）。对方在该 session 里跑一轮，回复只写进那个 session。
- **定时任务与工具由对方自己做**：若用户说「让 B 每天 9 点汇报」，你只需把「请给自己加一个每天 9 点的汇报任务」发到 B 的 session；B 在回复时会用自己的 cron 技能给自己加任务。无需你调 cron.add(agentId: B)。

## 使用顺序

1. 用 **gateway_agents_list** 拿到可委托的 agent 列表。
2. 用 **gateway_agent_send_to_session** 把任务描述发到目标 agent 的 session（通常用默认 main 即可）。
3. 可提示用户「已转交 xxx，请打开该 agent 的会话查看回复」。
