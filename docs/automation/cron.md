---
title: "Cron"
summary: "In-process scheduler, cron/jobs.json storage, runTurn on schedule, optional deliver. No separate cron:daemon needed."
read_when:
  - Configuring or debugging scheduled tasks
  - Understanding storage vs execution (Cron runs in Agent)
  - Comparing cron:daemon vs in-process scheduler
---

# Cron

> **Cron and Heartbeat:** Heartbeat is implemented as a cron job; see [Heartbeat](./heartbeat.md).

Cron in ParameciumU is defined by **cron/jobs.json** under each Agent dir and **executed inside the Agent process** by `runScheduler` (runTurn on schedule, optional push to connector). Gateway only exposes cron RPC (list/add/update/remove/run); it does not run jobs.

## Overview

- **Storage:** `cron/jobs.json` per agent dir (e.g. `./.first_paramecium/cron/jobs.json`), read/write via `@monou/cron` CronStore. Gateway `CRON_STORE` points to the default agent store; RPC can pass `agentId` to target another agent’s store.
- **Execution:** Inside **apps/agent**. After connect, the agent starts `runScheduler(cronStorePath, { onJobDue, shouldRunJob, log })`. For jobs with `payload.kind === "agentTurn"`, onJobDue calls `runOneTurn(message)`; optional `deliver` triggers connector.message.push.
- **No separate process:** `npm run agent` already includes the scheduler. You do **not** need `npm run cron:daemon`. `cron:daemon` is a standalone process that only advances timestamps and does **not** run agent turns; use only in special cases.

## Quick start

1. **Start the agent** (scheduler is in-process):

   ```bash
   GATEWAY_URL=ws://127.0.0.1:9347 AGENT_ID=.first_paramecium AGENT_DIR=./.first_paramecium npm run agent
   ```

   On connect, a job named `Heartbeat` is ensured (created if missing); the in-process scheduler starts.

2. **View/manage via Gateway RPC** (Control UI, TUI, or WebSocket):

   - `cron.list` — list jobs
   - `cron.add` / `cron.update` / `cron.remove` — create/update/delete
   - `cron.run` — advance timing (lastRunAtMs/nextRunAtMs); actual execution is still triggered by the agent’s onJobDue

3. **Job definition:** Edit `AGENT_DIR/cron/jobs.json` or use the **cron** skill tools (cron_add, cron_update, etc.) via Gateway.

## Schedule types

(@monou/cron, see packages/cron types.)

| kind   | Description        | Example |
|--------|--------------------|---------|
| `at`   | One-shot ISO time  | `"2026-03-01T09:00:00Z"` |
| `every`| Fixed interval (ms)| `everyMs: 600_000` (10 min) |
| `cron` | Cron expr + optional tz | `"0 9 * * *"`, `tz: "Asia/Shanghai"` |

## Payload and execution

- **agentTurn** — `payload.kind === "agentTurn"`; `payload.message` is the user message for that turn. onJobDue sets MEMORY_WORKSPACE, CRON_STORE, then calls runOneTurn(message). If job.deliver?.connectorId and chatId exist and reply is non-empty, connector.message.push is sent.
- **systemEvent** — No LLM; runtime handles directly (e.g. heartbeat check, process status). See [cron skill](../../.first_paramecium/skills/cron/SKILL.md).
- **Heartbeat** — Job named `Heartbeat` reads HEARTBEAT.md; if effectively empty, skip run; reply is stripHeartbeatOk’d; then Gateway `agent.heartbeat` updates lastHeartbeatAt. See [Heartbeat](./heartbeat.md).

## Storage and multi-agent

- Single agent: default `./.first_paramecium/cron/jobs.json` (or env `CRON_STORE`).
- Multiple agents: each dir has its own `cron/jobs.json`. Gateway cron RPC can take `agentId`; execution is by the runScheduler in the process for that AGENT_DIR.

## cron:daemon vs in-process

| Mode | Description |
|------|-------------|
| **In-process runScheduler** | Default. Started after connect; onJobDue → runOneTurn; deliver and Heartbeat supported. |
| **npm run cron:daemon** | Standalone process; only advances lastRunAtMs/nextRunAtMs; does **not** run agent turns. For “advance time only” use cases. |

## Code references

| Topic | Location |
|-------|----------|
| Scheduler | packages/cron/src/scheduler.ts: runScheduler(storePath, { onJobDue, shouldRunJob, log }) |
| Agent startup | apps/agent/src/index.ts: ensureHeartbeatJob, runScheduler |
| Store and types | packages/cron: CronStore, CronJob, at/every/cron |
| Gateway RPC | apps/gateway: cron.list, cron.add, cron.update, cron.remove, cron.run, cron.runs |

## Next steps

- [Heartbeat](./heartbeat.md) — Online proof and periodic run
- [Agent running](../runtime/agent-running.md) — runOneTurn, buildSessionFromU, onJobDue
- [Apps](../runtime/apps.md) — Agent and cron in-process
- [Agent directory](../concepts/agent-directory.md) — cron/jobs.json and deliver
