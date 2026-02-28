---
name: agent-creator
description: Create and connect new Paramecium agents. Use when the user wants to spawn a new agent (clone from template, new AGENT_ID), run it locally or prepare for remote deploy. Provides scripts and references for creating agent dirs and connecting to Gateway.
---

# Agent Creator

Create new agent directories from the ParameciumU template and connect them to the Gateway (run locally or deploy remotely).

## When to use

- User asks to "创建新 agent" / "克隆一只草履虫" / "再起一个智能体" / "add a new node".
- User wants to run a second agent with a different AGENT_ID on the same or another machine.
- User needs steps or scripts for "本机新建 Agent" or "远程部署" (see references/remote-deploy.md).

## Core workflow

1. **Create agent directory**  
   Use the script `scripts/create-and-connect.sh` from the **monorepo root**. Set `AGENT_ID` and `GATEWAY_URL`; optionally `AGENT_DIR` (default: `./agents/<AGENT_ID>`).  
   The script ensures the agent dir exists (from `@monou/agent-template`), then starts the agent process so it connects to the Gateway.

2. **From monorepo root** (replace `my_agent` and Gateway URL as needed):

   ```bash
   AGENT_ID=my_agent GATEWAY_URL=ws://127.0.0.1:9347 ./.first_paramecium/skills/agent-creator/scripts/create-and-connect.sh
   ```

   If the repo uses `.first_paramecium` as the default agent dir, the script path is under `.first_paramecium/skills/agent-creator/`. If the user's default agent dir has a different name (e.g. `.u`), use that path instead.

3. **Remote deploy**  
   See [references/remote-deploy.md](references/remote-deploy.md) for installing Node, syncing the repo, building, and running the agent with `GATEWAY_URL` / `AGENT_ID` / `AGENT_DIR`.

## Guidelines

- Always run `create-and-connect.sh` from the **repository root** so that `npm run agent` and template paths resolve correctly.
- `AGENT_DIR` must be an absolute path or relative to repo root; the script will resolve it. Default is `./agents/<AGENT_ID>`.
- After the new agent connects, the user can refresh the Control UI topology to see the new node.
