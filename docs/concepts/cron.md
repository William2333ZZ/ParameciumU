# Cron

Scheduled jobs are stored in a JSON file and computed with `@monou/cron`. The Agent process runs the scheduler and executes due jobs (e.g. Heartbeat). This page is derived from `packages/cron`.

## Store path

- **Default**: `./.first_paramecium/cron/jobs.json` under the given `cwd` (see `getDefaultStorePath(cwd)` in `packages/cron/src/index.ts`).
- **Override**: Set `CRON_STORE` to an absolute or relative path; the store is a single JSON file.
- **Per-agent**: For the default local agent the Gateway uses the workspace root; for other agents the code uses `rootDir/agents/<agentId>/cron/jobs.json`. The Agent app uses `AGENT_DIR/cron/jobs.json`.

## Store format

```ts
// CronStoreFile
{
  "version": 1,
  "jobs": [ /* CronJob[] */ ]
}
```

## Job shape (CronJob)

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique id (set on create). |
| `name` | string | Display name (e.g. "Heartbeat"). |
| `description` | string? | Optional description. |
| `enabled` | boolean | Whether the job is active. |
| `deleteAfterRun` | boolean? | If true and schedule is "at", remove after one run. |
| `createdAtMs` | number | Creation timestamp. |
| `updatedAtMs` | number | Last update timestamp. |
| `schedule` | CronSchedule | When to run (see below). |
| `payload` | CronPayload | What to run (see below). |
| `state` | CronJobState | nextRunAtMs, lastRunAtMs, lastStatus, lastError. |
| `deliver` | CronDeliver? | Optional push target (connectorId, chatId) after run. |

## Schedule (CronSchedule)

- **at**: `{ kind: "at", at: string }` — Run once at a given time (parsed by `parseAbsoluteTimeMs`).
- **every**: `{ kind: "every", everyMs: number, anchorMs?: number }` — Recurring interval (e.g. 30 minutes). `anchorMs` aligns the first run.
- **cron**: `{ kind: "cron", expr: string, tz?: string }` — Cron expression (via `croner`); optional timezone.

Next run is computed by `computeNextRunAtMs(schedule, nowMs)` in `packages/cron/src/schedule.ts`.

## Payload (CronPayload)

- **systemEvent**: `{ kind: "systemEvent", text: string }` — System message.
- **agentTurn**: `{ kind: "agentTurn", message: string }` — Run one agent turn with the given message (e.g. Heartbeat prompt). When the run completes, result can be pushed to a connector if `deliver` is set.

## CronStore API (in-memory + file)

- **list(opts?)** — List jobs (optionally include disabled); sorted by next run.
- **status()** — Returns storePath, job count, nextWakeAtMs.
- **add(input: CronJobCreate)** — Create job; id and timestamps are set.
- **update(id, patch: CronJobPatch)** — Patch job and recompute next run.
- **remove(id)** — Remove job.
- **run(id, mode?)** — Mark job as run and advance nextRunAtMs; `mode` "due" or "force". The Store does **not** execute the LLM; the Agent process runs the scheduler and performs the actual agent turn for `agentTurn` payloads.

## Scheduler and Agent app

The Agent process uses `runScheduler` from `@monou/cron/scheduler` and reads jobs from `AGENT_DIR/cron/jobs.json`. When a job is due, it runs the agent turn (e.g. Heartbeat message), then optionally pushes the result via Gateway to the configured connector. A default Heartbeat job is created on first connect if missing (name "Heartbeat", every 30 minutes, agentTurn with a learning/report prompt).

See [Reference: Cron types](../reference/cron-types.md) for full type definitions.
