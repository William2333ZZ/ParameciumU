---
name: agent-creator
description: Create a new monoU agent and connect it to Gateway. Use when the user asks to create/new/spawn an agent (本地或远程). Supports one-command local creation, remote deploy, Windows persistent startup, and skill/persona customization.
entryScript: scripts/create-and-connect.sh
---

# Agent Creator

Create a new agent directory under `agents/<agent_id>/`, then start the agent app so it appears in Control UI.

## Use This Skill When

- User asks: "create agent", "new agent", "新建智能体", "帮我拉起一个 agent"
- Need to create an agent on local machine or a remote host

Do not use cron tools for this workflow.

## Fast Path (Local)

From monoU root:

```bash
AGENT_ID=<agent_id> GATEWAY_URL=ws://127.0.0.1:9347 \
  .first_paramecium/skills/agent-creator/scripts/create-and-connect.sh
```

This will:

1. Create `agents/<agent_id>/`
2. Copy base files/skills
3. Start the agent app in background

## Controlled Path (Local, custom persona/skills)

1) Create directory only:

```bash
AGENT_DIR=$(pwd)/agents/<agent_id> MONOU_ROOT=$(pwd) \
  SKILLS="base_skill memory cron" \
  .first_paramecium/skills/agent-creator/scripts/create-agent-dir.sh
```

2) Edit `SOUL.md` / `IDENTITY.md` if needed  
3) Start:

```bash
nohup env GATEWAY_URL=ws://127.0.0.1:9347 AGENT_ID=<agent_id> \
  AGENT_DIR=$(pwd)/agents/<agent_id> \
  .first_paramecium/skills/agent-creator/scripts/start-agent-client.sh \
  >> .gateway/agent-<agent_id>.log 2>&1 &
```

## Remote Host Flow

Follow [references/remote-new-host.md](references/remote-new-host.md):

1. Detect remote OS and whether monoU exists
2. Copy monoU if missing (Linux/macOS: rsync, Windows: tar+scp)
3. Build on remote
4. Create agent dir and start client

If remote is Windows and you need persistence after SSH disconnect, use:

- [references/remote-windows-start.md](references/remote-windows-start.md)
- `scripts/start-remote-windows-agent.sh`

## Important Rules

- Never mutate current running agent directory as target.
- Always create target under `agents/<agent_id>/`.
- For remote connection, ensure `GATEWAY_URL` is reachable from remote machine.
- Ask user for credentials; never hardcode secrets in scripts.
- Do not block on agentId confirmation. If user does not provide a clean id, auto-generate one and proceed, then report the final agentId.
- Accept noisy user input like `agentId=xxx（` by normalizing it before execution.

## Script Index

- `scripts/create-and-connect.sh` — one-command local flow
- `scripts/create-agent-dir.sh` — create directory only
- `scripts/start-agent-client.sh` — start agent app only
- `scripts/deploy-to-remote.sh` — sync repo to remote
- `scripts/get-local-gateway-url.sh` — print reachable Gateway URL
- `scripts/start-remote-windows-agent.sh` — Windows scheduled-task startup

## References

- [references/gateway-connect.md](references/gateway-connect.md)
- [references/remote-deploy.md](references/remote-deploy.md)
- [references/remote-new-host.md](references/remote-new-host.md)
- [references/remote-windows-start.md](references/remote-windows-start.md)
- [references/soul-and-identity.md](references/soul-and-identity.md)
- [references/skill-library.md](references/skill-library.md)
