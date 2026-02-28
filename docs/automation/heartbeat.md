---
title: Heartbeat（在线证明与周期学习）
summary: Heartbeat 语义、Cron 中的实现、与 Gateway 的 lastHeartbeatAt 及学习/汇报统一。
read_when:
  - 配置或排查定时心跳、学习汇报时
  - 理解 Cron 与 Heartbeat 关系时
---

# Heartbeat：在线证明与周期学习

> 与 Agent 目录、执行过程一起的代码级整合说明见 [Agent 运行机制](../runtime/agent-running.md)。

本文档说明 ParameciumU 中 **heartbeat** 的语义、与 Gateway 的关系、在 Cron 中的实现，以及如何与「不断学习」目标统一。

## Heartbeat 的双重含义

| 含义 | 说明 | 实现方式 |
|------|------|----------|
| **在线证明** | Agent 在 Gateway 侧「活着」的证明 | ① WebSocket 连接存在即视为在线；② Agent 执行心跳任务后调用 `agent.heartbeat`，Gateway 更新该连接的 `lastHeartbeatAt`；③ `agents.list` 返回中带 `lastHeartbeatAt`，供 Control UI 显示「最近活跃」 |
| **周期学习/汇报** | 以固定节奏做一轮思考、汇报或自检 | 由 **Cron** 中名为 `Heartbeat` 的定时任务驱动：到点跑一轮 agent turn（读 HEARTBEAT.md、汇报进展、无事则回复 HEARTBEAT_OK） |

结论：**Heartbeat 必须由 Cron 参与**——要么是名为 `Heartbeat` 的 cron 任务，要么与「学习/汇报」任务合一。

## 是否需要在 Cron 里启动 Heartbeat？

**需要。** 当前实现已是这样：

- Agent 进程连接 Gateway 成功后，会**自动确保** `cron/jobs.json` 中存在名为 `Heartbeat` 的定时任务（若不存在则创建，默认 `enabled: true`）。
- 该任务的**执行**由同一 Agent 进程内的 `runScheduler` 负责：到点触发、跑一轮 agent turn、可选通过 `deliver` 推送到 Connector。
- **Cron 负责「何时跑」；Heartbeat 任务负责「跑什么」**。

建议：默认将 Heartbeat 任务 **enabled: true**。若已有其他「学习汇报」类任务，可二选一：保留两条（Heartbeat 间隔 ≤ 其他），或**只保留一条**，把「学习/汇报」当作 Heartbeat（推荐）。

## 活动时段（可选）

Heartbeat 任务可通过环境变量限制仅在部分时段执行：

- `HEARTBEAT_ACTIVE_HOURS_START`、`HEARTBEAT_ACTIVE_HOURS_END`（HH:MM 24h）
- `HEARTBEAT_ACTIVE_HOURS_TZ`（IANA 或 `"local"`）

未配置则始终在时段内。实现：`apps/agent` 的 `shouldRunJob` 在 `job.name === "Heartbeat"` 时调用 `isWithinActiveHours(nowMs)`。

## 默认语义与 HEARTBEAT.md

- 默认 prompt 为「汇报当前思考与进展」，可读 `HEARTBEAT.md`（若存在）。
- 若 HEARTBEAT.md 内容有效为空（仅标题/空列表），则**跳过当次执行**。
- 若无事可汇报，模型回复 `HEARTBEAT_OK`，则不向用户推送，仅作自检与在线证明；执行完后仍会调用 `agent.heartbeat` 上报。

## 实现要点小结

1. **必须在 Cron 里有一条 Heartbeat（或与学习合一的任务）**：由 Agent 连接后 `ensureHeartbeatJob` 确保存在，由 `runScheduler` 到点执行。
2. **在线证明**：WebSocket 在线 + 执行完 Heartbeat 后 `agent.heartbeat` 上报；Gateway 更新 `lastHeartbeatAt`，`agents.list` 返回该字段。
3. **存储与执行**：任务定义在 Agent 目录 `cron/jobs.json`；执行在 Agent 进程内，不在 Gateway。

## 排查：`onJobDue failed: 400 Extra data: line 1 column …`

该错误来自 **LLM API（或其代理）** 在解析请求体时失败（常见于 Python 后端的 `json.loads` 报错 "Extra data"），而非 Cron/Heartbeat 逻辑本身。

- **含义**：请求发到 BIANXIE_BASE_URL（或当前配置的 LLM 地址）时，服务端返回 400，且错误信息中带有 "Extra data"，多为服务端把非单条 JSON 或非法格式当 JSON 解析导致。
- **建议**：
  1. 检查 `BIANXIE_BASE_URL` / `AIHUBMIX_BASE_URL` 等是否指向正确、网络/代理是否可达。
  2. 若使用自建或第三方代理，确认其兼容 OpenAI 请求格式、且不会改写或拼接请求体。
  3. 当前实现：Heartbeat 轮次若因该类错误失败，仍会调用 `agent.heartbeat`，Gateway 会更新 `lastHeartbeatAt`，节点不会因单次 API 失败被误判为离线。

## 下一步

- [定时任务（Cron）](./cron.md) — 存储、执行、cron:daemon 与内嵌调度器
- [Agent 运行机制](../runtime/agent-running.md) — ensureHeartbeatJob、onJobDue、stripHeartbeatOk
- [Gateway 协议](../gateway/protocol.md) — agent.heartbeat、agents.list
- [Agent 目录约定](../concepts/agent-directory.md) — cron/jobs.json、HEARTBEAT.md
