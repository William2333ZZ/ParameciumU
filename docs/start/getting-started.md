# Getting Started

## Prerequisites

- **Node.js ≥ 20**
- For LLM-backed agents: set `OPENAI_API_KEY` or `AIHUBMIX_API_KEY` and `AIHUBMIX_BASE_URL` (copy root `env.example` to `.env`)

## Build

From the repo root:

```bash
git clone <your-repo-url> ParameciumU && cd ParameciumU
npm install
npm run build
```

The build compiles shared, agent-core, skills, cron, agent-sdk, agent-template, llm-provider, agent-from-dir, tui, gateway, and apps (gateway, agent). Order is fixed in the root `package.json` `build` script.

## Prepare an agent directory

There is **no default agent directory**. You must create or copy one and pass it explicitly.

To use the default template (first paramecium layout):

```bash
cp -r packages/agent-template/template .first_paramecium
# Or from a script: ensureAgentDir({ rootDir: process.cwd() }) from @monou/agent-template
```

The template includes `IDENTITY.md`, `SOUL.md`, `MEMORY.md`, `KNOWLEDGE.md`, `skills/` (base_skill, code_skill, todo_skill, memory, knowledge, cron, etc.), and `cron/jobs.json`. See [Agent directory](./concepts/agent-directory.md).

## Run Gateway

From the repo root (or the directory you use as “workspace root” for the default cron store):

```bash
npm run gateway
```

- Listens by default on `ws://127.0.0.1:9347`.
- Env: `GATEWAY_PORT`, `GATEWAY_HOST`, `GATEWAY_DATA_DIR` (or `GATEWAY_STATE_DIR`), `CRON_STORE`, `GATEWAY_TOKEN` / `GATEWAY_PASSWORD`, `GATEWAY_TLS_CERT` / `GATEWAY_TLS_KEY`. See [Gateway](./concepts/gateway.md) and [Reference / Env](./reference/env.md).

## Run Agent

In a separate terminal, point the Agent at your Gateway and at one agent directory:

```bash
export GATEWAY_URL=ws://127.0.0.1:9347
export AGENT_ID=.first_paramecium
export AGENT_DIR=./.first_paramecium
npm run agent
```

- `GATEWAY_URL` or `GATEWAY_WS_URL`: WebSocket URL of the Gateway.
- `AGENT_ID`: Unique id for this agent (e.g. `.first_paramecium`).
- `AGENT_DIR`: Absolute or relative path to the agent directory (no default).

Optional: `DEVICE_ID`, `GATEWAY_TOKEN`, `GATEWAY_PASSWORD`. The Agent connects, registers as `role: "agent"`, and runs turns when the Gateway sends `node.invoke` (e.g. from Control UI). It also runs a local cron scheduler; jobs are stored in `AGENT_DIR/cron/jobs.json`. On first connect, a default Heartbeat job is created if missing.

## Run Control UI

```bash
npm run control-ui
```

Then open http://localhost:5173, enter the Gateway URL (e.g. `ws://127.0.0.1:9347`), connect, and start a chat. The UI uses the Gateway protocol (`chat.send`, `chat.history`, etc.).

## Run TUI

```bash
npm run tui
# or: node apps/tui/dist/index.js
```

Same idea: configure Gateway URL and agent; chat in the terminal.

## Summary

1. **Build** once with `npm run build`.
2. **Create** an agent dir (e.g. `.first_paramecium`) from the template or your own.
3. **Start Gateway** with `npm run gateway`.
4. **Start Agent** with `GATEWAY_URL`, `AGENT_ID`, and `AGENT_DIR` set, then `npm run agent`.
5. **Open Control UI** with `npm run control-ui` and connect to the Gateway.

All docs are derived from the codebase; for env vars and protocol details see [Reference](./reference/env.md).
