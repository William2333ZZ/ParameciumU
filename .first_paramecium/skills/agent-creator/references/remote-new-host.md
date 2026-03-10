# New Remote Host Workflow

## Step 1: detect host and repo

- Check OS
- Check monoU existence

## Step 2: copy monoU (if missing)

- Linux/macOS: `deploy-to-remote.sh` (rsync)
- Windows: tar + scp + extract

## Step 3: build remote monoU

```bash
cd <remote-monoU> && npm install && npm run build
```

## Step 4: create and start agent

Linux/macOS:

```bash
AGENT_DIR=$(pwd)/agents/<agent_id> MONOU_ROOT=$(pwd) \
  SKILLS="base_skill memory cron" \
  .first_paramecium/skills/agent-creator/scripts/create-agent-dir.sh
```

Then launch the agent app with reachable `GATEWAY_URL`.

Windows:

- Create agent dir (manual/copy)
- Start via scheduled task (recommended): see [remote-windows-start.md](remote-windows-start.md)

## Step 5: verify in Control UI

- Refresh nodes/agents list
- Confirm new `agent_id` online
