# Cron

定时任务存储在单个 JSON 文件中，由 `@monou/cron` 计算下次运行时间。Agent 进程运行调度器并执行到期任务（如 Heartbeat）。本文依据 `packages/cron` 编写。

## 存储路径

- **默认**：给定 `cwd` 下的 `./.first_paramecium/cron/jobs.json`（见 `packages/cron/src/index.ts` 中的 `getDefaultStorePath(cwd)`）。
- **覆盖**：设置 `CRON_STORE` 为绝对或相对路径；存储为单个 JSON 文件。
- **按智能体**：默认本地智能体由 Gateway 使用工作区根；其他智能体使用 `rootDir/agents/<agentId>/cron/jobs.json`。Agent 应用使用 `AGENT_DIR/cron/jobs.json`。

## 存储格式

```ts
// CronStoreFile
{
  "version": 1,
  "jobs": [ /* CronJob[] */ ]
}
```

## 任务结构（CronJob）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 唯一 id（创建时设定）。 |
| `name` | string | 显示名（如 "Heartbeat"）。 |
| `description` | string? | 可选描述。 |
| `enabled` | boolean | 是否启用。 |
| `deleteAfterRun` | boolean? | 为 true 且 schedule 为 "at" 时，运行一次后删除。 |
| `createdAtMs` | number | 创建时间戳。 |
| `updatedAtMs` | number | 最后更新时间戳。 |
| `schedule` | CronSchedule | 何时运行（见下）。 |
| `payload` | CronPayload | 运行内容（见下）。 |
| `state` | CronJobState | nextRunAtMs、lastRunAtMs、lastStatus、lastError。 |
| `deliver` | CronDeliver? | 可选，运行后推送目标（connectorId、chatId）。 |

## 调度（CronSchedule）

- **at**：`{ kind: "at", at: string }` — 在给定时间运行一次（由 `parseAbsoluteTimeMs` 解析）。
- **every**：`{ kind: "every", everyMs: number, anchorMs?: number }` — 按间隔重复（如 30 分钟）。`anchorMs` 用于对齐首次运行。
- **cron**：`{ kind: "cron", expr: string, tz?: string }` — Cron 表达式（通过 `croner`）；可选时区。

下次运行时间由 `packages/cron/src/schedule.ts` 中的 `computeNextRunAtMs(schedule, nowMs)` 计算。

## 载荷（CronPayload）

- **systemEvent**：`{ kind: "systemEvent", text: string }` — 系统消息。
- **agentTurn**：`{ kind: "agentTurn", message: string }` — 用给定消息执行一轮 agent 回合（如 Heartbeat 提示）。运行完成后若设置了 `deliver`，可将结果推送到对应 connector。

## CronStore API（内存 + 文件）

- **list(opts?)** — 列出任务（可选包含已禁用）；按下次运行时间排序。
- **status()** — 返回 storePath、任务数、nextWakeAtMs。
- **add(input: CronJobCreate)** — 创建任务；id 与时间戳由内部设置。
- **update(id, patch: CronJobPatch)** — 修补任务并重新计算下次运行。
- **remove(id)** — 删除任务。
- **run(id, mode?)** — 标记为已运行并推进 nextRunAtMs；`mode` 为 "due" 或 "force"。Store **不**执行 LLM；Agent 进程运行调度器并对 `agentTurn` 载荷实际执行 agent 回合。

## 调度器与 Agent 应用

Agent 进程使用 `@monou/cron/scheduler` 的 `runScheduler`，从 `AGENT_DIR/cron/jobs.json` 读取任务。任务到期时执行 agent 回合（如 Heartbeat 消息），并可选择通过 Gateway 将结果推送到配置的 connector。首次连接时若不存在会创建默认 Heartbeat 任务（名称 "Heartbeat"，每 30 分钟，agentTurn 为学习/汇报类提示）。

完整类型定义见 [参考：Cron 类型](../reference/cron-types.md)。
