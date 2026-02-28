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
| **gateway_agent_send_to_session** | 向指定 agent 的 session 发送一条消息；该 agent 会在**目标 session** 内执行并回复。不传 sessionKey 时使用对方主会话 agent:<targetAgentId>:main。 |
