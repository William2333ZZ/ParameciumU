# Cron Types

From `packages/cron/src/types.ts`. Used by the cron skill, Gateway, and Agent app.

## CronSchedule

```ts
type CronSchedule =
  | { kind: "at"; at: string }
  | { kind: "every"; everyMs: number; anchorMs?: number }
  | { kind: "cron"; expr: string; tz?: string };
```

- **at**: Run once at a given time string (parsed by `parseAbsoluteTimeMs`).
- **every**: Recurring interval in ms; optional `anchorMs` for alignment.
- **cron**: Cron expression; optional `tz` (IANA or default from runtime).

## CronPayload

```ts
type CronPayload =
  | { kind: "systemEvent"; text: string }
  | { kind: "agentTurn"; message: string };
```

- **systemEvent**: System message only.
- **agentTurn**: Run one agent turn with the given prompt (e.g. Heartbeat).

## CronDeliver

```ts
type CronDeliver = {
  connectorId: string;
  chatId: string;
};
```

Optional; when set and payload is agentTurn, the run result can be pushed to this connector/chat.

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

Persisted as JSON at the store path (e.g. `AGENT_DIR/cron/jobs.json` or `CRON_STORE`).

## CronJobCreate

Same as CronJob but without `id`, `createdAtMs`, `updatedAtMs`; `state` is optional (partial). Used for `CronStore.add()`.

## CronJobPatch

Partial patch for update; can include partial `payload` and `state`. Used for `CronStore.update()`.

## CronStatus

```ts
type CronStatus = {
  storePath: string;
  jobs: number;
  nextWakeAtMs: number | null;
};
```

Returned by `CronStore.status()`.

## CronRunResult

```ts
type CronRunResult =
  | { ok: true; ran: true }
  | { ok: true; ran: false; reason: "not-due" | "already-running" }
  | { ok: false; error: string };
```

Returned by `CronStore.run(id, mode)`.
