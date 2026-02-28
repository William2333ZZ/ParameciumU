# Gateway Protocol

Types and method list from `packages/gateway/src/protocol.ts`. Transport: WebSocket; first message should be **connect** with identity; then JSON request/response and server-push events.

## Request

```ts
type GatewayRequest = {
  method: string;
  params?: Record<string, unknown>;
  id?: string;
};
```

Send one object per request. `id` is echoed in the response for correlation.

## Response

```ts
type GatewayResponse = {
  id?: string;
  ok: boolean;
  payload?: unknown;
  error?: { code: number; message: string };
  meta?: Record<string, unknown>;
};
```

- `ok: true` → use `payload`.
- `ok: false` → use `error.code` and `error.message`.

## Server event (push)

```ts
type GatewayEvent = {
  event: string;
  payload: unknown;
};
```

Emitted by the server without a request id (e.g. agent.run.chunk, agent.run.done).

## Connect identity

```ts
type ConnectIdentity = {
  role?: "operator" | "agent" | "node" | "client" | "connector";
  agentId?: string;           // required for role "agent"
  deviceId?: string;
  connectorId?: string;       // required for role "connector", e.g. "feishu"
  connectorDisplayName?: string;
  capabilities?: string[];
  vncPort?: number;           // for role "node", noVNC port
};
```

Send as `connect` params. If the server has auth enabled, include `token` or `password` in params.

## Methods (GATEWAY_METHODS)

| Method | Category |
|--------|----------|
| connect | Session |
| health, status | Health |
| cron.list, cron.status, cron.add, cron.update, cron.remove, cron.run, cron.runs | Cron |
| agents.list | Agents |
| sessions.list, sessions.preview, sessions.delete, sessions.getTree, sessions.navigate, sessions.fork, sessions.patch | Sessions |
| agent, agent.heartbeat, agent.wait | Agent run |
| chat.history, chat.send, chat.abort | Chat |
| skills.status | Skills |
| node.list, node.invoke, node.invoke.result | Nodes |
| connector.mapping.list, connector.mapping.add, connector.mapping.remove, connector.mapping.resolve | Connector mapping |
| connector.message.inbound, connector.message.push | Connector message |

Exact list: see `GATEWAY_METHODS` in `packages/gateway/src/protocol.ts`.

## Events (GATEWAY_EVENTS)

health, cron, presence, agent, agent.run.started, agent.run.chunk, agent.run.done, node.invoke.request, connector.message.push.

Exact list: see `GATEWAY_EVENTS` in `packages/gateway/src/protocol.ts`.
