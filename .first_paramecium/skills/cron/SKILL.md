---
name: cron
description: Manage scheduled tasks: list, create, update, delete, and immediately trigger jobs. Supports at (one-shot), every (fixed interval), and cron expression schedules. Two execution modes — agentTurn (LLM agent runs a turn) and systemEvent (no LLM, handled directly by the runtime). Use when the user wants to schedule something at a time or interval, view existing jobs, or manage cron tasks.
---

# Cron

Manage scheduled tasks stored in `cron/jobs.json`. Cron runs **inside the agent process** — no separate daemon needed. Start with `npm run agent` and the scheduler is already running.

## Two payload kinds: when does the LLM get involved?

This is the most important distinction when creating a job:

| `payload.kind` | Who executes it | Use when |
|----------------|----------------|----------|
| **`agentTurn`** | The LLM agent runs a full turn with `message` as input. Can use tools, reason, write to memory, push to Feishu. | Task requires reasoning: summarize news, analyze data, write a report, send a message based on conditions. |
| **`systemEvent`** | No LLM. The runtime fires the event directly — heartbeat check, process monitoring, lightweight code execution. | Task is deterministic and doesn't need reasoning: confirm the agent is alive, check a process, run a script. |

**Heartbeat** is a built-in example of a `systemEvent`-style job: named `Heartbeat`, it runs periodically, reads `HEARTBEAT.md`, and skips the LLM turn if there is nothing to do — it just calls `agent.heartbeat` to report the agent is alive.

## Schedule types

| kind | Fields | Example |
|------|--------|---------|
| `at` | `at`: ISO datetime string | `{ kind: "at", at: "2026-06-01T09:00:00Z" }` |
| `every` | `everyMs`: interval in ms, optional `anchorMs` | `{ kind: "every", everyMs: 1800000 }` (every 30 min) |
| `cron` | `expr`: cron expression, optional `tz` | `{ kind: "cron", expr: "0 9 * * *", tz: "Asia/Shanghai" }` |

## Tools

### cron_list
List jobs sorted by next run time. Pass `includeDisabled: true` to include disabled jobs.

### cron_status
Return the store path, job count, and time until the next scheduled run.

### cron_add
Create a job. Required: `name`, `schedule`, `payload`.

```
// Reasoning task — agent turn
{
  name: "Daily summary",
  schedule: { kind: "cron", expr: "0 20 * * *", tz: "Asia/Shanghai" },
  payload: { kind: "agentTurn", message: "Summarize today's activity and write to memory." }
}

// System task — no LLM
{
  name: "Heartbeat",
  schedule: { kind: "every", everyMs: 600000 },
  payload: { kind: "systemEvent", text: "heartbeat" }
}
```

Optional fields: `description`, `enabled` (default `true`), `deleteAfterRun` (default `true` for `at` jobs).

### cron_update
Update a job by `id`. Pass `patch` with any fields to change (name, description, enabled, schedule, payload, deleteAfterRun).

### cron_remove
Delete a job by `id`.

### cron_run
Immediately trigger a job's timing (updates `lastRunAtMs` and `nextRunAtMs`). Does not directly execute the agent turn — the agent process's scheduler handles actual execution on the next tick.  
`mode`: `"force"` (default, run regardless of schedule) or `"due"` (only if due).

## Execution & storage

- **Execution**: runs inside `apps/agent` process. `runScheduler()` starts after Gateway connection and calls `runOneTurn(message)` for each due `agentTurn` job. `systemEvent` jobs are handled without LLM.
- **Results delivery**: add `deliver: { connectorId, chatId }` to a job's payload to push the agent's reply to Feishu (or another connector) after each run.
- **Storage**: `AGENT_DIR/cron/jobs.json`. Overridable with the `CRON_STORE` env var.
- **Multi-agent**: each agent has its own `cron/jobs.json`. Gateway cron RPC accepts `agentId` to target a specific agent's store.
