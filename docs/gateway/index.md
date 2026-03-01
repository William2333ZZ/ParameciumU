---
title: "Gateway overview"
summary: "ParameciumU Hub (Gateway): single WebSocket server, relation to Agent/Node/Client, protocol and how to run."
read_when:
  - First time understanding Gateway’s place in the architecture
  - Running or integrating with Gateway
---

# Gateway overview (Hub)

The **Hub** (Gateway) is ParameciumU’s **single center**: a single long-lived WebSocket server that handles connect, routing, sessions, RPC, and events. It **does not** run agent turns, LLM, or cron execution.

## What it is

- **apps/gateway** — Long-lived process; default bind `127.0.0.1:9347` (env `GATEWAY_PORT`, `GATEWAY_HOST`).
- **packages/gateway** — Protocol types and client (e.g. `callGateway`); independent of who runs the server.
- **Clients** — Control UI, TUI, apps/agent, feishu-app, sandbox-node, browser-node, etc. connect over WebSocket; first message is **connect** (role, agentId/deviceId, optional token/password).

## Responsibility boundary

| Does | Does not |
|------|----------|
| connect, routing, session management (sessions.*) | Run LLM or agent loop |
| cron.* RPC (read/write cron store) | Execute cron (execution is in Agent process) |
| agent / chat.send / agent.wait / chat.abort (forward to agent) | Store SOUL/IDENTITY/skills or user memory |
| node.list, node.invoke (forward to nodes) | Write sessions into agent dir (sessions in .gateway) |
| connector.mapping.*, connector.message.push | |

## How to run

```bash
# From repo root
npm run build
npm run gateway

# Custom port
GATEWAY_PORT=9348 npm run gateway
```

Env: `GATEWAY_PORT`, `GATEWAY_HOST`, `GATEWAY_DATA_DIR`, `CRON_STORE`, `GATEWAY_TOKEN`/`GATEWAY_PASSWORD`, etc. See [apps](../runtime/apps.md).

## Next steps

- [Gateway protocol](./protocol.md) — Connect, RPC, sessions, events, extension
- [Multi-agent](./multi-agent.md) — Discovery and delegation between agents
- [Apps](../runtime/apps.md) — Gateway env and data dirs
- [Architecture](../concepts/architecture.md) — Hub, Agent, Node, Definition, Client
