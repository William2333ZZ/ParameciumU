# Persistent Windows agent via scheduled task

When starting `agent-client` on a remote Windows machine via SSH with `start /b node ...`, the process is killed when the SSH session ends. To keep the agent running after SSH disconnects, use a **Windows scheduled task** — the task runs in its own session independent of SSH.

## Overview

1. Create a `.bat` file in the remote monoU directory that sets env vars and runs `node apps\gateway\dist\agent-client.js`.
2. Create a scheduled task on the remote pointing to that `.bat` (set to a far-future "once" trigger so it never auto-runs — only triggered manually).
3. To start or restart the agent: SSH in, optionally kill existing `node.exe`, then `schtasks /run /tn <task-name>`.

Never hardcode SSH credentials in the skill or scripts — ask the user.

## 1. The .bat file

On the remote at `C:\Users\<username>\monoU\start-<agent_id>.bat`:

```bat
@echo off
cd /d C:\Users\<username>\monoU
set GATEWAY_URL=ws://<local-reachable-address>:9347
set AGENT_ID=<agent_id>
set AGENT_DIR=C:\Users\<username>\monoU\agents\<agent_id>
node apps\gateway\dist\agent-client.js
```

Use **absolute paths** — relative paths can fail when the task runs outside an interactive session.

## 2. Create the scheduled task (one-time setup)

```cmd
schtasks /create /tn "MonouAgent_<agent_id>" /tr "C:\Users\<username>\monoU\start-<agent_id>.bat" /sc once /st 23:59 /sd 2030/01/01 /f
```

`/sc once /st 23:59 /sd 2030/01/01` sets a far-future trigger so the task never auto-starts — it only runs when you call `schtasks /run`.

## 3. Start / restart the agent

```cmd
# Optional: kill any existing node process first
taskkill /F /IM node.exe

# Trigger the task
schtasks /run /tn "MonouAgent_<agent_id>"
```

The task runs the `.bat` in the background; the `node` process stays alive after SSH disconnects.

## One-command script (from local machine)

`scripts/start-remote-windows-agent.sh` automates the full flow:

- Generates the `.bat` locally and scps it to the remote.
- Creates/overwrites the scheduled task via SSH.
- Optionally kills existing `node.exe` (`KILL_FIRST=1`), then triggers `schtasks /run`.

Required env vars: `REMOTE_USER`, `REMOTE_HOST`, `AGENT_ID`, `GATEWAY_URL`, `REMOTE_MONOU` (Windows absolute path to monoU on the remote, e.g. `C:\Users\<username>\monoU`).  
Optional: `REMOTE_AGENT_DIR` (defaults to `REMOTE_MONOU\agents\AGENT_ID`), `SSHPASS` (for password auth), `KILL_FIRST=1`.

```bash
REMOTE_USER=<user> REMOTE_HOST=<host> \
AGENT_ID=<agent_id> \
GATEWAY_URL=ws://<local-reachable-address>:9347 \
REMOTE_MONOU='C:\Users\<username>\monoU' \
"$AGENT_DIR/skills/agent-creator/scripts/start-remote-windows-agent.sh"
```
