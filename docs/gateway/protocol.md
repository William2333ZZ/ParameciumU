---
title: "Gateway protocol"
summary: "Gateway protocol, server vs client, connect roles, sessions, RPC, node.invoke, security."
read_when:
  - Integrating or extending the Gateway
  - Understanding sessions, connect, and RPC
---

# Gateway protocol and implementation

This doc describes the ParameciumU Gateway protocol: server vs client, connection roles, sessions, RPC, and node.invoke. Implementation: **packages/gateway** (types + client) and **apps/gateway** (WebSocket server). The protocol is ParameciumU-specific; evolution follows ParameciumU needs.

## Layering

```
Clients (Control UI / TUI / CLI / Feishu-app)
         │
         ▼
packages/gateway — protocol types + callGateway() for one-off RPC
         │
         ▼
apps/gateway — WebSocket server: connect, route, handlers, sessions, cron, node.invoke
         │
         ├── @monou/cron (CronStore)
         ├── Connected agent processes (apps/agent) — execute agent/chat
         └── Connected node processes (sandbox-node, browser-node, connector nodes) — node.invoke targets
```

- **packages/gateway** — Protocol and call interface only; independent of who runs the server.
- **apps/gateway** — Single long-lived process; full RPC and connection handling; **does not run agent turns**; execution is done by connected apps/agent.

## Connect and identity

The first message can be **connect**, with:

- **role** — `operator` | `agent` | `node` | `client` | `connector`
- **agentId** — For agent role; identifies the agent to Gateway.
- **deviceId** — For agent or node; used as nodeId for nodes.
- Optional: **sessionKey**, **token** / **password**
- For **connector** role: optional **connectorId**, **connectorDisplayName**

The server stores the connection in context; **agents.list** and **node.list** are derived from these connections. Without connect you can still call stateless/read-only methods (health, cron.list); session and routing need identity.

## Main RPC methods

(Full list in packages/gateway GATEWAY_METHODS.)

- **connect** — Register identity (role, agentId, deviceId, connectorId, etc.).
- **health**, **status** — Health and status.
- **cron.list**, **cron.status**, **cron.add**, **cron.update**, **cron.remove**, **cron.run**, **cron.runs**
- **agents.list** (includes lastHeartbeatAt; see [Heartbeat](../automation/heartbeat.md)), **sessions.list**
- **agent.heartbeat** — Agent reports after heartbeat run; updates “last active”.
- **sessions.preview**, **sessions.patch**, **sessions.delete**
- **agent** — Run one turn (message required); forwarded to connected agent; 501 if no agent.
- **agent.wait** — Wait by runId for result.
- **chat.history**, **chat.send**, **chat.abort**
- **skills.status**
- **node.list**, **node.invoke** — node.list returns connected nodes (and connectors); node.invoke sends request to node and returns result when node sends node.invoke.result.
- **connector.mapping.list/add/remove/resolve**
- **connector.message.inbound**, **connector.message.push** — Inbound messages and push to connectors.

Request shape: `{ "method": "...", "params": { ... }, "id": "..." }`.  
Response shape: `{ "id": "...", "ok": true|false, "payload": { ... } }`; on error `"error": { "code", "message" }`.

## Sessions and chat

- **Session storage** — Metadata in `.gateway/sessions/sessions.json`; transcript in `.gateway/sessions/transcripts/&lt;sessionKey&gt;.json`. Every session has a sessionKey; if not provided, one is created (e.g. `agent:.first_paramecium:s-&lt;timestamp&gt;-&lt;random&gt;`).
- **sessions.list / sessions.preview** — Return session store; optional sessionKey filter.
- **sessions.patch** — Update displayName, channel, sendPolicy, thinkingLevel, contextTokens, totalTokens, model.
- **Session expiry** — Env SESSION_RESET_MODE (daily/idle/none), SESSION_RESET_AT_HOUR, SESSION_IDLE_MINUTES.
- **Explicit reset** — Message starting with `/new` or `/reset` forces a new session, then the rest is the first message.

**agent / chat.send / agent.wait / chat.abort**:

- **agent** — params.message required; optional sessionKey/sessionId, wait. Without wait returns `{ runId }`; use **agent.wait**(runId) to get result; with wait returns `{ runId, text?, toolCalls? }` directly.
- **chat.send** — Send to session and run agent; returns `{ text, toolCalls? }`.
- **chat.abort** — params.runId; abort that run.
- **Streaming** — Server emits agent.run.started, agent.run.chunk, agent.run.done; clients can subscribe for typing effect.

## node.invoke flow

1. Caller sends **node.invoke** (nodeId, command, params).
2. Server finds the connection for nodeId, sends **node.invoke.request** (with unique invokeId) to that connection and keeps a pending Promise.
3. Node runs the command and sends **node.invoke.result** (same invokeId + result).
4. Server resolves the Promise and returns the result as the node.invoke response.

So “reasoning in agent, tools in node” is implemented by Gateway forwarding and matching. Agents use **gateway_skill**’s **gateway_node_invoke** (which calls node.invoke) to run browser, sandbox, or other node commands. See [node-creator](../../.first_paramecium/skills/node-creator/SKILL.md) and [architecture](../concepts/architecture.md).

## Events (server push)

Examples: health, cron, presence, agent, agent.run.started, agent.run.chunk, agent.run.done, node.invoke.request. Clients subscribe by event after connecting.

## Client usage

```ts
import { callGateway } from "@monou/gateway";

const jobs = await callGateway&lt;{ jobs: unknown[] }&gt;({
  url: "ws://127.0.0.1:9347",
  method: "cron.list",
  params: { includeDisabled: true },
});

// With auth, connect first (Control UI / TUI keep connection and send connect).
```

## Security and transport

- **Auth** — GATEWAY_TOKEN or GATEWAY_PASSWORD; if either is set, connect must send token or password; server checks with timing-safe compare.
- **TLS** — GATEWAY_TLS_CERT, GATEWAY_TLS_KEY point to cert and key files to enable wss.

## Extending

- New RPC: add method to GATEWAY_METHODS in packages/gateway and implement in apps/gateway createHandlers; inject dependencies via context.
- Sessions/transcripts are managed by sessionStorePath and resolveSession.
- Agent execution is done by connected agent processes; node execution by connected nodes (role=node). Connector-layer apps (e.g. Feishu) can connect as node or connector and use connector.message.inbound / push.

## Next steps

- [Architecture](../concepts/architecture.md)
- [Apps and env vars](../runtime/apps.md)
- [Agent directory](../concepts/agent-directory.md) · [Agent running](../runtime/agent-running.md)
- [Getting started](../start/getting-started.md)
