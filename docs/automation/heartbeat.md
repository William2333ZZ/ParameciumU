---
title: "Heartbeat"
summary: "Online proof (lastHeartbeatAt) and periodic run (Cron Heartbeat job). Unified with learning/report."
read_when:
  - Configuring or debugging heartbeat and periodic learning
  - Understanding how Cron and Heartbeat relate
---

# Heartbeat: online proof and periodic run

> Code-level integration with agent dir and execution: [Agent running](../runtime/agent-running.md).

This doc explains **heartbeat** in ParameciumU: meaning, relation to Gateway, and how it is implemented via Cron.

## Two aspects of Heartbeat

| Aspect | Description | How |
|--------|-------------|-----|
| **Online proof** | Agent is “alive” from Gateway’s view | ① WebSocket up ⇒ online. ② After running the heartbeat task, agent calls `agent.heartbeat`; Gateway sets that connection’s `lastHeartbeatAt`. ③ `agents.list` includes lastHeartbeatAt for UI (“last active”). |
| **Periodic run** | Fixed cadence for one turn (learn/report/self-check) | A **Cron** job named `Heartbeat` runs on schedule: runOneTurn (read HEARTBEAT.md, report progress, or reply HEARTBEAT_OK if nothing). |

So **Heartbeat always involves Cron** — either a job named `Heartbeat` or a combined “learning/report” job.

## Do you need a Heartbeat job in Cron?

**Yes.** Current behavior:

- When the agent process connects to Gateway, it **ensures** a job named `Heartbeat` exists in cron/jobs.json (creates it if missing, default enabled: true).
- **Execution** is done by the same process’s runScheduler: on schedule it runs one agent turn; optional deliver to connector.
- **Cron** decides when; the **Heartbeat** job defines what (prompt, HEARTBEAT.md).

Recommendation: keep Heartbeat **enabled: true**. If you have another “learning/report” job, either keep both (Heartbeat interval ≤ the other) or **use a single job** and treat learning/report as Heartbeat.

## Active hours (optional)

Restrict Heartbeat to certain hours via env:

- `HEARTBEAT_ACTIVE_HOURS_START`, `HEARTBEAT_ACTIVE_HOURS_END` (HH:MM 24h)
- `HEARTBEAT_ACTIVE_HOURS_TZ` (IANA or `"local"`)

Unset ⇒ always active. Implemented in apps/agent: shouldRunJob for `job.name === "Heartbeat"` uses isWithinActiveHours(nowMs).

## Default semantics and HEARTBEAT.md

- Default prompt asks for “current thinking and progress”; can read **HEARTBEAT.md** if present.
- If HEARTBEAT.md is effectively empty (only title/empty list), **skip** that run.
- If there’s nothing to report, model replies HEARTBEAT_OK; no push to user; still call `agent.heartbeat` for online proof.

## Summary

1. **Cron must have a Heartbeat (or combined learning) job** — ensureHeartbeatJob on connect; runScheduler runs it on schedule.
2. **Online proof** — WebSocket + `agent.heartbeat` after Heartbeat run; Gateway updates lastHeartbeatAt; agents.list returns it.
3. **Storage and execution** — Jobs in agent dir cron/jobs.json; execution in agent process, not in Gateway.

## Troubleshooting: `onJobDue failed: 400 Extra data`

When the request to the LLM endpoint returns 400 with “Extra data,” the server is often mis-parsing JSON (e.g. non-single JSON or invalid format). Check:

1. `BIANXIE_BASE_URL` / `AIHUBMIX_BASE_URL` (or your LLM URL) is correct and reachable.
2. Network/proxy; try a simple curl to the same URL.

## Next steps

- [Cron](./cron.md) — Storage, schedule types, deliver
- [Agent running](../runtime/agent-running.md) — ensureHeartbeatJob, onJobDue, stripHeartbeatOk
