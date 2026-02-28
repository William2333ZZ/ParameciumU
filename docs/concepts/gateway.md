# Gateway

The Gateway is a WebSocket server that routes connections, sessions, cron, and agent runs. It does **not** run the LLM or store agent personality; the Agent process does execution. This page summarizes behavior from `apps/gateway` and `packages/gateway`.

## Server

- **Default**: `ws://127.0.0.1:9347` (port 9347, host 127.0.0.1).
- **Env**: `GATEWAY_PORT`, `GATEWAY_HOST`. Optional TLS: `GATEWAY_TLS_CERT`, `GATEWAY_TLS_KEY`. Data dir: `GATEWAY_DATA_DIR` or `GATEWAY_STATE_DIR` (default `./.gateway`). Auth: `GATEWAY_TOKEN` or `GATEWAY_PASSWORD` (connect must send `token` or `password`). Agent heartbeat timeout: `GATEWAY_AGENT_HEARTBEAT_TIMEOUT_MS` (0 = no disconnect).
- **Cron store**: `CRON_STORE` overrides the default path; otherwise the default is under the workspace (e.g. `.first_paramecium/cron/jobs.json` for the default local agent).

## Connection and identity

First message should be **connect** with an identity object. Supported fields (see `ConnectIdentity` in `packages/gateway/src/protocol.ts`):

| Field | Description |
|-------|-------------|
| `role` | `"operator"` \| `"agent"` \| `"node"` \| `"client"` \| `"connector"` |
| `agentId` | For `role: "agent"`; one connection per agentId. |
| `deviceId` | Optional device identifier. |
| `connectorId` | For `role: "connector"` (e.g. feishu). |
| `connectorDisplayName` | Optional display name for connector. |
| `capabilities` | Optional string array. |
| `vncPort` | For `role: "node"`; noVNC port for Control UI proxy. |

If auth is enabled, connect must include `token` or `password`. After connect, the client can send request objects `{ method, params?, id }` and receives responses `{ id?, ok, payload?, error? }` and server events `{ event, payload }`.

## Methods (RPC)

The full list is in `GATEWAY_METHODS` (`packages/gateway/src/protocol.ts`). Summary:

- **connect** — Identity and optional sessionKey.
- **health**, **status** — Liveness and status.
- **cron.*** — cron.list, cron.status, cron.add, cron.update, cron.remove, cron.run, cron.runs.
- **agents.list** — List connected agents.
- **sessions.*** — sessions.list, sessions.preview, sessions.delete, sessions.getTree, sessions.navigate, sessions.fork, sessions.patch.
- **agent**, **agent.heartbeat**, **agent.wait** — Run agent turn, heartbeat, wait for run.
- **chat.history**, **chat.send**, **chat.abort** — Session chat.
- **skills.status** — Skills status.
- **node.list**, **node.invoke**, **node.invoke.result** — Node (e.g. browser) listing and invocation.
- **connector.mapping.*** — connector.mapping.list, add, remove, resolve.
- **connector.message.inbound**, **connector.message.push** — Connector messages.

See [Gateway protocol](../reference/gateway-protocol.md) for request/response and event types.

## Events (server → client)

`GATEWAY_EVENTS`: health, cron, presence, agent, agent.run.started, agent.run.chunk, agent.run.done, node.invoke.request, connector.message.push.

## Data and hooks

- Session store and transcripts live under the Gateway data dir (paths from `session-store.js`).
- Connector mappings are persisted in the data dir (e.g. `MAPPINGS_FILE`).
- Hooks can be discovered from workspace `.u/hooks`, data dir `hooks`, and bundled hooks; used for lifecycle/events.
