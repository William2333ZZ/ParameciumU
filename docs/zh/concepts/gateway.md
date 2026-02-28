# Gateway

Gateway 是一个 WebSocket 服务端，负责连接、会话、cron 与 agent 运行的路由。**不**运行 LLM，也不存储智能体人格；执行由 Agent 进程完成。本文基于 `apps/gateway` 与 `packages/gateway` 整理。

## 服务端

- **默认**：`ws://127.0.0.1:9347`（端口 9347，主机 127.0.0.1）。
- **环境变量**：`GATEWAY_PORT`、`GATEWAY_HOST`。可选 TLS：`GATEWAY_TLS_CERT`、`GATEWAY_TLS_KEY`。数据目录：`GATEWAY_DATA_DIR` 或 `GATEWAY_STATE_DIR`（默认 `./.gateway`）。认证：`GATEWAY_TOKEN` 或 `GATEWAY_PASSWORD`（connect 时须带 `token` 或 `password`）。Agent 心跳超时：`GATEWAY_AGENT_HEARTBEAT_TIMEOUT_MS`（0 表示不因超时断开）。
- **Cron 存储**：`CRON_STORE` 可覆盖默认路径；否则默认在工作区下（如默认本地智能体为 `.first_paramecium/cron/jobs.json`）。

## 连接与身份

首条消息应为 **connect**，并携带身份对象。支持字段见 `packages/gateway/src/protocol.ts` 中的 `ConnectIdentity`：

| 字段 | 说明 |
|------|------|
| `role` | `"operator"` \| `"agent"` \| `"node"` \| `"client"` \| `"connector"` |
| `agentId` | `role: "agent"` 时使用；每个 agentId 仅允许一个连接。 |
| `deviceId` | 可选设备标识。 |
| `connectorId` | `role: "connector"` 时使用（如 feishu）。 |
| `connectorDisplayName` | 可选，connector 展示名。 |
| `capabilities` | 可选字符串数组。 |
| `vncPort` | `role: "node"` 时可选；Control UI 代理 noVNC 的端口。 |

若启用认证，connect 的 params 中须包含 `token` 或 `password`。连接成功后，客户端发送请求对象 `{ method, params?, id }`，收到响应 `{ id?, ok, payload?, error? }` 及服务端事件 `{ event, payload }`。

## 方法（RPC）

完整列表见 `packages/gateway/src/protocol.ts` 中的 `GATEWAY_METHODS`。概览：

- **connect** — 身份及可选 sessionKey。
- **health**、**status** — 存活与状态。
- **cron.*** — cron.list、cron.status、cron.add、cron.update、cron.remove、cron.run、cron.runs。
- **agents.list** — 已连接智能体列表。
- **sessions.*** — sessions.list、sessions.preview、sessions.delete、sessions.getTree、sessions.navigate、sessions.fork、sessions.patch。
- **agent**、**agent.heartbeat**、**agent.wait** — 执行 agent 回合、心跳、等待运行结束。
- **chat.history**、**chat.send**、**chat.abort** — 会话聊天。
- **skills.status** — 技能状态。
- **node.list**、**node.invoke**、**node.invoke.result** — 节点（如 browser）列表与调用。
- **connector.mapping.*** — connector.mapping.list、add、remove、resolve。
- **connector.message.inbound**、**connector.message.push** —  connector 消息。

请求/响应与事件类型见 [Gateway 协议](../reference/gateway-protocol.md)。

## 事件（服务端 → 客户端）

`GATEWAY_EVENTS`：health、cron、presence、agent、agent.run.started、agent.run.chunk、agent.run.done、node.invoke.request、connector.message.push。

## 数据与钩子

- 会话存储与转录文件位于 Gateway 数据目录下（路径见 `session-store.js`）。
- Connector 映射持久化在数据目录（如 `MAPPINGS_FILE`）。
- 钩子可从工作区 `.u/hooks`、数据目录 `hooks` 及内置 hooks 发现，用于生命周期与事件。
