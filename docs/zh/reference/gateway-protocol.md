# Gateway 协议

类型与方法列表来自 `packages/gateway/src/protocol.ts`。传输：WebSocket；首条消息应为带身份的 **connect**；之后为 JSON 请求/响应及服务端推送事件。

## 请求

```ts
type GatewayRequest = {
  method: string;
  params?: Record<string, unknown>;
  id?: string;
};
```

每次请求发送一个对象。`id` 在响应中回显以便关联。

## 响应

```ts
type GatewayResponse = {
  id?: string;
  ok: boolean;
  payload?: unknown;
  error?: { code: number; message: string };
  meta?: Record<string, unknown>;
};
```

- `ok: true` → 使用 `payload`。
- `ok: false` → 使用 `error.code` 与 `error.message`。

## 服务端事件（推送）

```ts
type GatewayEvent = {
  event: string;
  payload: unknown;
};
```

由服务端主动发送，无请求 id（如 agent.run.chunk、agent.run.done）。

## Connect 身份

```ts
type ConnectIdentity = {
  role?: "operator" | "agent" | "node" | "client" | "connector";
  agentId?: string;           // role "agent" 时必填
  deviceId?: string;
  connectorId?: string;        // role "connector" 时必填，如 "feishu"
  connectorDisplayName?: string;
  capabilities?: string[];
  vncPort?: number;           // role "node" 时，noVNC 端口
};
```

作为 connect 的 params 发送。若服务端启用认证，params 中须包含 `token` 或 `password`。

## 方法（GATEWAY_METHODS）

| 方法 | 分类 |
|------|------|
| connect | 会话 |
| health、status | 健康 |
| cron.list、cron.status、cron.add、cron.update、cron.remove、cron.run、cron.runs | Cron |
| agents.list | 智能体 |
| sessions.list、sessions.preview、sessions.delete、sessions.getTree、sessions.navigate、sessions.fork、sessions.patch | 会话 |
| agent、agent.heartbeat、agent.wait | Agent 运行 |
| chat.history、chat.send、chat.abort | 聊天 |
| skills.status | 技能 |
| node.list、node.invoke、node.invoke.result | 节点 |
| connector.mapping.list、connector.mapping.add、connector.mapping.remove、connector.mapping.resolve | Connector 映射 |
| connector.message.inbound、connector.message.push | Connector 消息 |

完整列表见 `packages/gateway/src/protocol.ts` 中的 `GATEWAY_METHODS`。

## 事件（GATEWAY_EVENTS）

health、cron、presence、agent、agent.run.started、agent.run.chunk、agent.run.done、node.invoke.request、connector.message.push。

完整列表见 `packages/gateway/src/protocol.ts` 中的 `GATEWAY_EVENTS`。
