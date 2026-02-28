# ParameciumU Documentation

ParameciumU (monoU) is a **sovereign agent platform** where each agent is defined by a **standardized directory**: identity, soul, memory, knowledge, skills, and cron jobs live as files you own. Run the Gateway and Agent on your own machine; connect via Control UI, Feishu, or the terminal TUI. No LLM or personality data lives on a central server—execution and data stay at the edge.

## Core idea

- **Agent = folder.** An agent is a directory (e.g. `.first_paramecium`) with a fixed layout: `IDENTITY.md`, `SOUL.md`, `MEMORY.md`, `KNOWLEDGE.md`, `skills/`, `cron/jobs.json`. Version it, copy it, migrate it.
- **Gateway = router.** The Gateway is a WebSocket server. It routes messages, sessions, and cron; it does **not** run the LLM or store agent state. Connected Agent processes do the actual turns.
- **Explicit agent binding.** You set `AGENT_ID` and `AGENT_DIR` when starting the Agent. There is no default agent directory—you choose which folder is “this” agent.

## What’s in this docs

| Section | Description |
|--------|-------------|
| [Getting started](./start/getting-started.md) | Prerequisites, build, run Gateway, Agent, and Control UI |
| [Architecture](./concepts/architecture.md) | How Gateway, Agent, and agent directory fit together |
| [Agent directory](./concepts/agent-directory.md) | Layout, required files, skills, and how the runtime loads them |
| [Gateway](./concepts/gateway.md) | Port, env vars, roles, and high-level protocol |
| [Cron](./concepts/cron.md) | Store path, job schema, schedules, and payloads |
| [Apps](./runtime/apps.md) | Gateway app, Agent app, Control UI, TUI |
| [Reference](./reference/env.md) | [Environment variables](./reference/env.md), [Gateway protocol](./reference/gateway-protocol.md), [Cron types](./reference/cron-types.md) |

## Quick commands

```bash
# Build
npm install && npm run build

# Terminal 1: Gateway (default ws://127.0.0.1:9347)
npm run gateway

# Terminal 2: Agent (must set AGENT_DIR and AGENT_ID)
GATEWAY_URL=ws://127.0.0.1:9347 AGENT_ID=.first_paramecium AGENT_DIR=./.first_paramecium npm run agent

# Terminal 3: Web UI
npm run control-ui
```

Then open http://localhost:5173, enter the Gateway URL, and chat.

## License

MIT.
