# Gateway Skill 使用场景

本文列举「查 Gateway 连了哪些 Agent、每个能做什么、定时任务是什么」等场景，便于在对话中自然触发本 skill。

## 1. 发现与概览

- **「现在有哪些 agent 连着？」 / 「谁在线？」**  
  → `gateway_agents_list`，回复当前连到 Gateway 的 agentId、deviceId、在线状态、最近心跳。

- **「拓扑长什么样？有哪些节点？」**  
  → `gateway_nodes_list`，回复节点列表（每节点下有哪些 Agent）及 Connectors（如飞书）。

- **「飞书/接入有没有连上？」**  
  → `gateway_nodes_list` 看 `connectors` 是否非空及 online。

## 2. 能力查询（每个 Agent 能做什么）

- **「每个 agent 能做什么？」 / 「.u 有什么能力？」**  
  → 先 `gateway_agents_list` 得到 agentId 列表，再对关心的 agent 调 `gateway_skills_status(agentId)`，汇总技能名与说明。

- **「哪个 agent 有 web_search？」**  
  → `gateway_agents_list`，再对每个 agent 调 `gateway_skills_status(agentId)`，在返回里搜 web 相关技能。

- **「finance_learner 会干什么？」**  
  → `gateway_skills_status(agentId: "finance_learner")`。

## 3. 定时任务（Cron）

- **「定时任务有哪些？」 / 「.u 的 cron 是什么？」**  
  → `gateway_cron_list(agentId: ".u")`（或不传 agentId，默认 .u）。

- **「finance_learner 的定时任务是什么？」**  
  → `gateway_cron_list(agentId: "finance_learner")`。

- **「心跳任务什么时候下次跑？」**  
  → `gateway_cron_list(agentId)`，在 jobs 里找 Heartbeat 或对应任务，看 `nextRunAtMs`。

- **「有没有禁用的 cron？」**  
  → `gateway_cron_list(agentId, includeDisabled: true)`，看各 job 的 `enabled`。

## 4. 编排与建议

- **「让 finance_learner 跑一下学习」**  
  先 `gateway_agents_list` 确认该 agent 在线，再 `gateway_cron_list("finance_learner")` 看有没有学习类任务；可建议用户在 Control UI 点「立即运行」或通过会话向该 agent 发指令。

- **「谁适合做这件事？」**  
  → `gateway_agents_list` + 对候选 agent 调 `gateway_skills_status`，根据技能描述推荐。

- **「给能发消息的 agent 发一条提醒」**  
  → `gateway_agents_list`，结合 `gateway_skills_status` 或业务约定确定目标，再用 `sessions_send`（sessions_skill）发消息。

## 5. 排查与运维

- **「为什么收不到飞书推送？」**  
  → `gateway_nodes_list` 看 connectors 是否 online；再结合会话/映射说明需在 Control UI 检查 connector 映射与 deliver 配置。

- **「某 agent 的定时有没有在跑？」**  
  → `gateway_cron_list(agentId)` 看 jobs 的 `nextRunAtMs`、`lastRunAtMs`（若协议返回），并说明执行在 Agent 进程内、可看该进程日志。

- **「本机有几个 agent？」**  
  → `gateway_agents_list`，按 deviceId 或 node 聚合后回答。

## 6. 组合用法

- **「给我一份当前网关概览：谁连着、每个能干啥、.u 的定时任务」**  
  → 依次调用 `gateway_agents_list`、对每个 agent 一次 `gateway_skills_status`、`gateway_cron_list(".u")`，整理成一段话或列表回复。

以上场景均需 Agent 已连上 Gateway（如 `npm run agent`）；未连接时工具会返回「需要 Gateway」类错误。
