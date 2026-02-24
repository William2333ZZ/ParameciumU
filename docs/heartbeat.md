# Heartbeat：在线证明与周期学习

> 与 Agent 目录、执行过程一起的代码级整合说明见 [agent-running.md](./agent-running.md)。

本文档说明 monoU 中 **heartbeat** 的语义、与 Gateway 的关系、在 Cron 中的实现，以及如何与「不断学习」目标统一。

---

## 一、Heartbeat 的双重含义

| 含义 | 说明 | 实现方式 |
|------|------|----------|
| **在线证明** | Agent 在 Gateway 侧「活着」的证明 | ① WebSocket 连接存在即视为在线；② 可选：周期执行的心跳任务本身即证明「在跑」；③ 可选：Agent 执行心跳后向 Gateway 上报 `lastHeartbeatAt`，供 UI 显示「最近活跃」 |
| **周期学习/汇报** | 以固定节奏做一轮思考、汇报或自检 | 由 **Cron** 中的一条定时任务驱动：到点跑一轮 agent turn（读 HEARTBEAT.md、汇报进展、无事则回复 HEARTBEAT_OK） |

结论：**Heartbeat 必须由 Cron 参与**——要么是一条名为 Heartbeat 的 cron 任务，要么与「学习/分析」任务合一（一条任务同时承担「在线证明」与「周期学习」）。

---

## 二、是否需要在 Cron 里启动 Heartbeat？

**需要。** 且当前实现已是这样：

- Agent 进程连接 Gateway 成功后，会**自动确保** `cron/jobs.json` 中存在名为 `Heartbeat` 的定时任务（若不存在则创建）。
- 该任务的**执行**由同一 Agent 进程内的 `runScheduler` 负责：到点触发、跑一轮 agent turn、可选通过 `deliver` 推送到 Connector（如飞书）。
- 因此：**Cron 负责「何时跑」；Heartbeat 任务负责「跑什么」**。不在 Cron 里挂上这条任务，就没有周期性的「心跳式」学习/汇报。

建议：

- 默认将 Heartbeat 任务 **enabled: true**，体现「每个 Agent 默认就在做周期学习」。
- 若某 Agent 已有自己的「学习汇报」类任务（如「每 10 分钟汇报思考」），可以二选一：
  - **方案 A**：保留两条任务，且 **Heartbeat 间隔 ≤ 其他任务**（例如 Heartbeat 10 分钟，其他 30 分钟/1 小时），这样「最短间隔」的任务自然成为最频繁的在线证明。
  - **方案 B（推荐）**：**只保留一条任务**，把「学习/分析」当作默认的 Heartbeat——即这条任务既是 Heartbeat，也是学习汇报；命名可为 "Heartbeat" 或 "学习汇报"，语义上合一。

---

## 三、与其他定时任务的时间关系

- **Heartbeat 间隔 ≤ 其他任务**：若 Heartbeat 与「学习汇报」是两条任务，则 Heartbeat 建议作为**最短周期**（例如 10 分钟），其他任务（日报、周报等）用更长间隔（1h、1d）。
- **或 Heartbeat = 该任务**：若采用「一条任务 = Heartbeat = 学习汇报」，则不再有两条任务的时间比较问题，只需设定这一条的 `everyMs`（如 600_000 即 10 分钟）。

---

## 四、以「学习/分析」为默认 Heartbeat

为体现**不断学习**的目标，推荐：

- 每个 Agent 的**默认 Heartbeat 任务**即其**默认的周期学习/汇报任务**：
  - 默认 prompt 使用「汇报当前思考与进展」类语义（并可读 `HEARTBEAT.md` 若存在）。
  - 若无事可汇报，模型回复 `HEARTBEAT_OK`，则不向用户推送，仅作一次「自检」与在线证明。

这样：

- **一个任务**同时承担：在线证明 + 周期学习。
- 每个 Agent 自带「以学习/分析为默认心跳」的语义，产品上更一致。

实现上：在 `apps/agent` 中创建/确保 Heartbeat 任务时，使用学习导向的默认 `message`（见下节），并默认 `enabled: true`。

---

## 五、与 OpenClaw 的对比（执行逻辑）

| 维度 | OpenClaw | monoU |
|------|----------|--------|
| 执行主体 | 网关侧或独立 runner 调 agent 跑一轮 | Agent 进程内 `runScheduler` + `onJobDue` 跑一轮 |
| 存储 | 配置/调度在网关或配置中心 | 任务定义在 Agent 目录 `cron/jobs.json` |
| 语义 | 定时唤醒、读 HEARTBEAT、可推送到渠道 | 一致：定时 agent turn、HEARTBEAT.md、HEARTBEAT_OK、可选 deliver 到 Connector |
| 协议 | 自有 channel/heartbeat 配置 | 不兼容；monoU 用 Gateway + Cron RPC + connector.message.push |

**结论**：执行逻辑**概念上一致**——都是「周期跑一轮 agent、读 HEARTBEAT、无事则 HEARTBEAT_OK、可选推送」；monoU 用**单一 Cron 机制**统一实现，且任务与数据在 Agent 目录，更符合「定义即文件、执行在边缘」的原则。

---

## 六、实现要点小结

1. **必须在 Cron 里有一条 Heartbeat（或与学习合一的任务）**：由 Agent 连接后 `ensureHeartbeatJob` 确保存在，由 `runScheduler` 到点执行。
2. **时间关系**：Heartbeat 间隔 ≤ 其他任务，或**一条任务 = Heartbeat = 学习汇报**（推荐）。
3. **默认语义**：默认 Heartbeat 即「学习/汇报」任务，默认启用，prompt 为学习导向，并支持 `HEARTBEAT.md` 覆盖。
4. **在线证明**：WebSocket 连接 = 在线；Agent 每次执行完 Heartbeat 任务后会调用 Gateway 的 `agent.heartbeat`，Gateway 更新该连接的 `lastHeartbeatAt`；`agents.list` 返回中带 `lastHeartbeatAt`，便于 UI 显示「最近活跃」。

以上与 [architecture.md](./architecture.md)、[gateway.md](./gateway.md)、[vision-and-roadmap.md](./vision-and-roadmap.md) 一致，并强化「不断学习」为默认心跳语义。
