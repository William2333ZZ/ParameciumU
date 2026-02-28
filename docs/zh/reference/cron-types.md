# Cron 类型

来自 `packages/cron/src/types.ts`。被 cron 技能、Gateway 与 Agent 应用使用。

## CronSchedule

```ts
type CronSchedule =
  | { kind: "at"; at: string }
  | { kind: "every"; everyMs: number; anchorMs?: number }
  | { kind: "cron"; expr: string; tz?: string };
```

- **at**：在给定时间字符串运行一次（由 `parseAbsoluteTimeMs` 解析）。
- **every**：按毫秒间隔重复；可选 `anchorMs` 对齐。
- **cron**：Cron 表达式；可选 `tz`（IANA 或使用运行时默认）。

## CronPayload

```ts
type CronPayload =
  | { kind: "systemEvent"; text: string }
  | { kind: "agentTurn"; message: string };
```

- **systemEvent**：仅系统消息。
- **agentTurn**：用给定提示执行一轮 agent 回合（如 Heartbeat）。

## CronDeliver

```ts
type CronDeliver = {
  connectorId: string;
  chatId: string;
};
```

可选；当 payload 为 agentTurn 且设置时，运行结果可推送到该 connector/chat。

## CronJobState

```ts
type CronJobState = {
  nextRunAtMs?: number;
  lastRunAtMs?: number;
  lastStatus?: "ok" | "error" | "skipped";
  lastError?: string;
};
```

## CronJob

```ts
type CronJob = {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  deleteAfterRun?: boolean;
  createdAtMs: number;
  updatedAtMs: number;
  schedule: CronSchedule;
  payload: CronPayload;
  state: CronJobState;
  deliver?: CronDeliver;
};
```

## CronStoreFile

```ts
type CronStoreFile = {
  version: 1;
  jobs: CronJob[];
};
```

持久化为存储路径下的 JSON（如 `AGENT_DIR/cron/jobs.json` 或 `CRON_STORE`）。

## CronJobCreate

与 CronJob 相同但不含 `id`、`createdAtMs`、`updatedAtMs`；`state` 可选（部分）。用于 `CronStore.add()`。

## CronJobPatch

用于 update 的部分修补；可包含部分 `payload` 与 `state`。用于 `CronStore.update()`。

## CronStatus

```ts
type CronStatus = {
  storePath: string;
  jobs: number;
  nextWakeAtMs: number | null;
};
```

由 `CronStore.status()` 返回。

## CronRunResult

```ts
type CronRunResult =
  | { ok: true; ran: true }
  | { ok: true; ran: false; reason: "not-due" | "already-running" }
  | { ok: false; error: string };
```

由 `CronStore.run(id, mode)` 返回。
