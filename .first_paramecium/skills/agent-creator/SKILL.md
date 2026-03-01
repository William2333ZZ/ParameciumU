---
name: agent-creator
description: "Create a new monoU Agent and connect it to the Gateway. Use only when the user says 'create agent', 'new agent', 'new 智能体', or similar. For local creation: run create-and-connect.sh via bash. For a new remote host: check OS (Linux/macOS or Windows) and whether monoU exists; copy it if not (rsync for Linux/macOS, tar+scp for Windows), then npm install/build on the remote, create agent dir, and start agent-client pointing to the local Gateway. Do NOT use cron tools (cron_add, cron_list, etc.) to create agents."
---

# Agent Creator

Create a new monoU Agent: build a new directory with the same structure as `.first_paramecium`, then start `agent-client` to connect to the Gateway so the agent appears in Control UI. **Never modify the current agent directory (`$AGENT_DIR`)**; always create `agents/<agent_id>/`.

## When to use this skill vs. cron

- User says **"create agent"**, **"new agent"** → use this skill.
- User says **"scheduled task"**, **"cron"**, **"reminder"** → use the **cron** skill instead.

## Local: one-command creation (recommended)

Run from the monoU root directory:

```bash
AGENT_ID=<agent-name> GATEWAY_URL=ws://127.0.0.1:9347 "$AGENT_DIR/skills/agent-creator/scripts/create-and-connect.sh"
```

- `<agent-name>`: name given by the user, e.g. `research_agent`.
- `GATEWAY_URL`: default `ws://127.0.0.1:9347` (matches `npm run gateway`).
- `$AGENT_DIR`: runtime env var pointing to the current agent directory (e.g. `.first_paramecium`).
- The script creates `agents/<AGENT_ID>/` (with SOUL, IDENTITY, base_skill, memory, cron) and starts agent-client in the background. Agent appears in Control UI when done.

To customize SOUL/IDENTITY before connecting, use the step-by-step flow below.

## New remote host: step-by-step

When creating an agent on a **new remote machine**:

1. **Check the remote host**: determine OS (`uname -a` or `cmd /c echo %OS%`) and whether monoU exists (`test -d monoU`). Skip step 2 if monoU is already there.
2. **Copy monoU**: Linux/macOS → rsync or `deploy-to-remote.sh`; Windows → tar (exclude node_modules/.git/dist) + scp + remote unzip. See [references/remote-new-host.md](references/remote-new-host.md).
3. **Build on remote**: run `npm install && npm run build` in the monoU directory (Windows: build each package in order if root build fails).
4. **Create agent and connect**: create agent dir, optionally customize SOUL/IDENTITY, start agent-client with `GATEWAY_URL` set to the address reachable from the remote machine.

Full commands and Windows details: [references/remote-new-host.md](references/remote-new-host.md). Do not hardcode SSH credentials — ask the user.

## Step-by-step (local, when customization is needed)

1. **Create agent directory** (in the monoU root):
   ```bash
   # $AGENT_DIR expands to current agent dir before the child env override takes effect
   AGENT_DIR=$(pwd)/agents/<agent_id> MONOU_ROOT=$(pwd) SKILLS="base_skill memory cron" "$AGENT_DIR/skills/agent-creator/scripts/create-agent-dir.sh"
   ```

2. **Customize SOUL/IDENTITY** (optional): edit `agents/<agent_id>/SOUL.md` and `agents/<agent_id>/IDENTITY.md`. See [references/soul-and-identity.md](references/soul-and-identity.md).

3. **Start agent-client in background**:
   ```bash
   nohup env GATEWAY_URL=ws://127.0.0.1:9347 AGENT_ID=<agent_id> AGENT_DIR=$(pwd)/agents/<agent_id> "$AGENT_DIR/skills/agent-creator/scripts/start-agent-client.sh" >> .gateway/agent-<agent_id>.log 2>&1 &
   ```
   For a remote host, replace `127.0.0.1:9347` with the address reachable from that machine (ask the user). Build gateway first if needed: `npm run build --workspace=@monou/gateway-app`.

## Scripts & references

| Resource | Purpose |
|----------|---------|
| **scripts/create-and-connect.sh** | One command: create dir + start agent-client in background (recommended for local) |
| scripts/create-agent-dir.sh | Create agent directory only (requires AGENT_DIR, MONOU_ROOT env vars) |
| scripts/start-agent-client.sh | Start agent-client only (requires GATEWAY_URL, AGENT_ID, AGENT_DIR; use `nohup ... &` to avoid blocking) |
| scripts/deploy-to-remote.sh | Sync monoU to a remote host (requires REMOTE_USER, REMOTE_HOST, REMOTE_PATH) |
| **scripts/start-remote-windows-agent.sh** | **Remote Windows**: start agent-client via scheduled task so it survives SSH disconnect |
| scripts/get-local-gateway-url.sh [port] | Print local IP and a GATEWAY_URL reachable by the remote |
| [references/remote-new-host.md](references/remote-new-host.md) | Full remote flow: OS check → copy monoU → npm install/build → create agent → start agent-client |
| [references/remote-windows-start.md](references/remote-windows-start.md) | Remote Windows persistent start via scheduled task |
| [references/remote-deploy.md](references/remote-deploy.md) | rsync usage, remote npm install/build, env vars |
| [references/gateway-connect.md](references/gateway-connect.md) | Confirm local/remote Gateway address |
| [references/soul-and-identity.md](references/soul-and-identity.md) | Write SOUL and IDENTITY |
| [references/skill-library.md](references/skill-library.md) | Skill library and copying skills to a new agent |
