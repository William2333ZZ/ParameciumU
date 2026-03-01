---
title: "Heartbeat (runtime)"
summary: "Heartbeat semantics and how it runs in the agent process. Full doc: automation/heartbeat."
read_when:
  - Configuring or debugging heartbeat
  - Understanding Cron and Heartbeat relation
---

# Heartbeat (runtime)

> **Full doc:** [Heartbeat (automation)](../automation/heartbeat.md). Code-level flow: [Agent running](./agent-running.md).

Heartbeat has two aspects:

1. **Online proof** — Gateway treats the agent as “alive”; after the Heartbeat cron run, the agent calls `agent.heartbeat` and Gateway sets `lastHeartbeatAt`; `agents.list` returns it for UI (“last active”).
2. **Periodic run** — A **Cron** job (e.g. named `Heartbeat`) runs on schedule: one agent turn (read HEARTBEAT.md, report progress, or HEARTBEAT_OK if nothing).

**You need a Heartbeat (or combined learning) job in Cron.** The agent process ensures one exists on connect (`ensureHeartbeatJob`); `runScheduler` runs it on schedule. Execution is in the agent process, not in Gateway.

## Next steps

- [Heartbeat (automation)](../automation/heartbeat.md) — Full semantics, active hours, HEARTBEAT.md, troubleshooting
- [Agent running](./agent-running.md) — ensureHeartbeatJob, onJobDue, stripHeartbeatOk
- [Cron](../automation/cron.md) — Storage, schedule types, deliver
