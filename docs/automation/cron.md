---
title: 定时任务（Cron）
summary: Agent 进程内调度器、cron/jobs.json 存储、到点执行 runTurn 与可选 deliver；无需单独运行 cron:daemon。
read_when:
  - 配置或排查定时任务时
  - 理解「存储与执行分离」、Cron 在 Agent 侧执行时
  - 区分 cron:daemon 与 agent 内嵌调度器时
---

# 定时任务（Cron）

> **定时任务与心跳**：Heartbeat 由 Cron 中的一条任务实现，详见 [Heartbeat](./heartbeat.md)。

定时任务在 ParameciumU 中由 **Agent 目录** 下的 `cron/jobs.json` 定义，由 **Agent 进程内** 的 `runScheduler` 到点执行（跑 agent turn、可选推送到 Connector）。Gateway 仅提供 cron 的 RPC（list/add/update/remove/run），不执行任务。

## 简要概述

- **存储**：每个 Agent 目录下的 `cron/jobs.json`（如 `./.first_paramecium/cron/jobs.json`），由 `@monou/cron` 的 `CronStore` 读写；Gateway 的 `CRON_STORE` 指向默认 agent 的 store，RPC 可带 `agentId` 读写对应目录。
- **执行**：在 **apps/agent** 进程内。Agent 连接 Gateway 成功后启动 `runScheduler(cronStorePath, { onJobDue, shouldRunJob, log })`，到点对 `payload.kind === "agentTurn"` 的任务调用 `runOneTurn(message)`，可选 `deliver` 推送到 connector。
- **无需单独进程**：启动 `npm run agent` 即带 Cron 调度，**不需要**也不应依赖 `npm run cron:daemon`。`cron:daemon` 为独立进程且**不执行** agent turn，仅推进任务时间戳，仅在特殊场景使用。

## 快速开始（可操作）

1. **启动 Agent**（Cron 已内嵌）：

   ```bash
   GATEWAY_URL=ws://127.0.0.1:9347 AGENT_ID=.first_paramecium AGENT_DIR=./.first_paramecium npm run agent
   ```

   连接成功后会自动确保存在名为 `Heartbeat` 的定时任务（若不存在则创建），并启动进程内调度器。

2. **通过 Gateway RPC 查看/管理任务**（需已连接 Control UI 或 TUI，或直接发 WebSocket 请求）：

   - `cron.list`：列出任务
   - `cron.add` / `cron.update` / `cron.remove`：增删改
   - `cron.run`：立即跑一次（仅更新 lastRunAtMs/nextRunAtMs，实际执行仍由 Agent 进程内 onJobDue 触发；通常用于「立即执行」语义时由 Gateway 侧触发一次派发）

3. **任务定义**：编辑 `AGENT_DIR/cron/jobs.json`，或通过 cron 技能工具（如 `cron_add`、`cron_update`）经 Gateway 调用。

## 调度类型（与代码一致）

`@monou/cron` 支持（见 `packages/cron` 类型定义）：

| kind   | 说明           | 示例 |
|--------|----------------|------|
| `at`   | 一次性 ISO 时间 | `"2026-03-01T09:00:00Z"` |
| `every`| 固定间隔（毫秒）| `everyMs: 600_000`（10 分钟） |
| `cron` | cron 表达式 + 可选时区 | `"0 9 * * *"`、`tz: "Asia/Shanghai"` |

## 任务 payload 与执行

- **agentTurn**：`payload.kind === "agentTurn"`，`payload.message` 为当轮用户消息。apps/agent 的 `onJobDue` 仅处理此类任务：设置 `MEMORY_WORKSPACE`、`CRON_STORE` 后调用 `runOneTurn(message)`；若 `job.deliver?.connectorId` 与 `job.deliver?.chatId` 存在且回复非空，则 `connector.message.push` 推送。
- **Heartbeat**：名为 `Heartbeat` 的 job 会读 `HEARTBEAT.md`，若内容有效为空则跳过当次执行；回复经 `stripHeartbeatOk` 后若不达下发条件则不下发；执行完后调用 Gateway `agent.heartbeat` 上报 lastHeartbeatAt。详见 [Heartbeat](./heartbeat.md)。

## 存储位置与多 Agent

- 单 Agent：默认 `./.first_paramecium/cron/jobs.json`（或环境变量 `CRON_STORE`）。
- 多 Agent：每个 Agent 目录各自 `cron/jobs.json`（如 `./A_agent/cron/jobs.json`）。Gateway 的 cron RPC 可带 `agentId` 指定读写哪个 store；执行由对应 AGENT_DIR 的 agent 进程内 runScheduler 负责。

## cron:daemon 与内嵌调度器对比

| 方式 | 说明 |
|------|------|
| **Agent 进程内 runScheduler** | 默认。连接成功后启动，到点执行 `onJobDue` → `runOneTurn`，支持 deliver、Heartbeat 上报。 |
| **npm run cron:daemon** | 独立进程，仅推进 `lastRunAtMs`/`nextRunAtMs`，**不**执行 agent turn。仅在「只推进时间、不跑 agent」等特殊需求时使用。 |

## 相关代码位置

| 主题 | 位置 |
|------|------|
| 调度器 | `packages/cron/src/scheduler.ts`：`runScheduler(storePath, { onJobDue, shouldRunJob, log })` |
| Agent 内启动 | `apps/agent/src/index.ts`：`ensureHeartbeatJob`、`runScheduler(cronStorePath, { onJobDue, shouldRunJob, log })` |
| 存储与类型 | `packages/cron`：`CronStore`、`CronJob`、调度类型 at/every/cron |
| Gateway RPC | `apps/gateway`：cron.list、cron.add、cron.update、cron.remove、cron.run、cron.runs |

## 下一步

- [Heartbeat](./heartbeat.md) — 在线证明与周期学习
- [Agent 运行机制](../runtime/agent-running.md) — runOneTurn、buildSessionFromU、onJobDue
- [应用说明 (apps)](../runtime/apps.md) — agent 行为与 Cron 内嵌说明
- [Agent 目录约定](../concepts/agent-directory.md) — cron/jobs.json 与 deliver 配置
