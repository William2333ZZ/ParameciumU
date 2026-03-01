---
title: "Getting started"
summary: "Build and run ParameciumU locally: Gateway, Agent, Control UI or TUI, step by step."
read_when:
  - First-time local setup
  - Starting Gateway / Agent / Control UI / TUI
  - Debugging connection or "no reply" issues
---

# Getting started

This doc walks you through building and running ParameciumU: Gateway, Agent, and Control UI or TUI. See [architecture.md](../concepts/architecture.md) for roles: Hub (Gateway), Agent, Node, Definition, Client.

## Prerequisites

- **Node.js >= 20**
- For LLM: set `OPENAI_API_KEY` or `AIHUBMIX_API_KEY` + `AIHUBMIX_BASE_URL` (copy repo root `env.example` to `.env`; dotenv loads it).

## 1. Build

From the repo root:

```bash
npm install
npm run build
```

Build order: packages (shared → agent-core → skills → cron → agent-sdk → agent-template → llm-provider → agent-from-dir → tui → gateway), then apps (gateway, agent, etc.). Control UI is Vite: `npm run control-ui` (dev) or `npm run control-ui:build` (output in apps/control-ui/dist).

## 2. Agent directory (required for agent)

There is no default; you must set **AGENT_DIR** and **AGENT_ID** when starting the agent.

If you don’t have an agent dir yet: create from template (same shape as `packages/agent-template/template`) or copy an existing one (e.g. `agents/code_engineer`).

Create from template (recommended):

```bash
node -e "require('@monou/agent-template').ensureAgentDir({ rootDir: process.cwd() })"
```

Or copy: `cp -r agents/code_engineer .first_paramecium`

## 3. Start Gateway

Terminal 1:

```bash
npm run gateway
```

Default: `ws://127.0.0.1:9347`. Custom port: `GATEWAY_PORT=9348 npm run gateway`. For auth, set `GATEWAY_TOKEN` or `GATEWAY_PASSWORD`; clients must send connect with the same token/password.

## 4. Start Agent (required for chat)

Gateway only routes; it does not run the agent. Start the agent in another terminal and point it at the same Gateway:

Terminal 2:

```bash
GATEWAY_URL=ws://127.0.0.1:9347 AGENT_ID=.first_paramecium AGENT_DIR=./.first_paramecium npm run agent
```

For multiple agents, open more terminals with different AGENT_ID and AGENT_DIR.

## 5. Control UI (web)

Terminal 3 (any time after Gateway and at least one agent are running):

```bash
npm run control-ui
```

Open http://localhost:5173, enter Gateway URL (e.g. `ws://127.0.0.1:9347`) and optional token/password. You can then see agents/nodes, sessions, cron, and chat with the agent.

## 6. TUI (terminal)

With Gateway and agent running:

```bash
npx u-tui
```

Main screen: chat. Type `/cron` for the cron panel; `q` to leave cron. TUI connects to Gateway; session history is in Gateway (e.g. .gateway/sessions/transcripts/).

## 7. Feishu (optional)

1. Configure the Feishu app and WebSocket (see `apps/feishu-app/env.example`).
2. Start Gateway and at least one agent.
3. Run feishu-app: `cd apps/feishu-app && npm run build && node dist/index.js`.
4. In Control UI or via RPC, set up connector mapping so Feishu sessions map to the desired agent.

## 8. Nodes (optional)

**Sandbox node** (system.run / system.which in isolated workspace):

```bash
GATEWAY_URL=ws://127.0.0.1:9347 SANDBOX_NODE_ID=sandbox-1 npm run sandbox-node
```

Default uses Docker; set `SANDBOX_USE_DOCKER=0` for local subprocess.

**Browser node** (Playwright WebKit for browser_fetch, etc.):

```bash
# In apps/browser-node: npx playwright install webkit, npm run build
GATEWAY_URL=ws://127.0.0.1:9347 npm run browser-node
```

Agents use **gateway_skill** → **gateway_nodes_list** and **gateway_node_invoke** to call nodes. See [node-creator](../../.first_paramecium/skills/node-creator/SKILL.md) and [apps.md](../runtime/apps.md).

## 9. Command summary

| Goal | Command |
|------|---------|
| Full build | `npm run build` |
| Start Gateway | `npm run gateway` |
| Start Agent | `GATEWAY_URL=ws://127.0.0.1:9347 AGENT_ID=.first_paramecium AGENT_DIR=./.first_paramecium npm run agent` |
| Control UI (dev) | `npm run control-ui` |
| TUI | `npx u-tui` |
| Sandbox node | `GATEWAY_URL=... npm run sandbox-node` |

**Cron:** Execution runs **inside the agent process**. After you start `npm run agent`, the same process runs runScheduler and executes cron/jobs.json (including Heartbeat) on schedule. You do **not** need `npm run cron:daemon` for normal use. `cron:daemon` is an optional separate process that only advances timestamps and does not run agent turns.

## Next steps

- [Architecture](../concepts/architecture.md)
- [Gateway protocol](../gateway/protocol.md)
- [Apps and env vars](../runtime/apps.md)
- [Agent directory](../concepts/agent-directory.md)
- [Deploy docs site](../deploy-docs-site.md)
