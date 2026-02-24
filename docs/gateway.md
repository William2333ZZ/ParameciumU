# Gateway 协议与实现

本文档说明 monoU Gateway 的协议、服务端与客户端分工、会话与 RPC、以及扩展要点。实现对应 `packages/gateway`（协议+客户端）与 `apps/gateway`（服务端）。协议为 monoU 自有设计，不承诺与任何外部系统（如 OpenClaw）兼容；演进以 monoU 需求为准。

## 一、分层与职责

```
调用方（Control UI / TUI / CLI）
         │
         ▼
packages/gateway — 协议类型 + callGateway() 单次 RPC
         │
         ▼
apps/gateway — WebSocket 服务端：connect、路由、handlers、会话、cron、node.invoke 转发
         │
         ├── @monou/cron（CronStore）
         ├── 已连接的 agent 进程（apps/agent）— 执行 agent/chat
         └── 已连接的 node 进程（如 sandbox-node）— node.invoke 目标
```

- **packages/gateway**：与「谁在跑服务端」解耦，只定义协议和调用方式；任何客户端只依赖此包即可调网关。
- **apps/gateway**：唯一常驻进程形态，实现完整 RPC 与连接管理；**不内嵌 runTurn**，agent 执行由已连接的 apps/agent 完成。

## 二、连接与身份

- 首条消息可为 `connect`，携带 `role`（operator / agent / node）、`agentId`、`deviceId`、可选 `sessionKey`、`token`/`password`。
- 服务端将连接写入 context.connections，后续 `agents.list`、`node.list` 均由此推导。
- 无 connect 时仍可调只读/无状态方法（health、cron.list 等）；需要会话/路由时依赖 identity。

## 三、主要 RPC 方法

支持的方法包括（详见 packages/gateway 的 GATEWAY_METHODS）：

- **connect** — 身份注册（role: operator | agent | node | client | connector；connector 时可选 connectorId、connectorDisplayName）
- **health**、**status** — 健康与状态
- **cron.list**、**cron.status**、**cron.add**、**cron.update**、**cron.remove**、**cron.run**、**cron.runs**
- **agents.list**（返回含 `lastHeartbeatAt`，见 [heartbeat.md](./heartbeat.md)）、**sessions.list**
- **agent.heartbeat** — Agent 执行完心跳任务后上报，用于更新「最近活跃」时间、**sessions.preview**、**sessions.patch**、**sessions.delete**
- **agent** — 执行一轮（message 必填；转发给已连接 agent，未连接则 501）
- **agent.wait** — 按 runId 等待结果
- **chat.history**、**chat.send**、**chat.abort**
- **skills.status**
- **node.list**、**node.invoke**、**node.invoke.result**（node 端回传）
- **connector.mapping.list**、**connector.mapping.add**、**connector.mapping.remove**、**connector.mapping.resolve**
- **connector.message.inbound**、**connector.message.push** — 入站消息与主动推送

请求形态：`{ "method": "...", "params": { ... }, "id": "..." }`。  
响应形态：`{ "id": "...", "ok": true|false, "payload": { ... } }`；失败时 `"error": { "code": number, "message": string }`。

## 四、会话与对话

- **会话存储**：元数据文件为 `.gateway/sessions/sessions.json`，单条会话记录在 `.gateway/sessions/transcripts/<sessionKey>.json`。所有会话都有 sessionKey；未指定时按时间新建（如 `agent:.u:s-<timestamp>-<random>`）。
- **sessions.list / sessions.preview**：返回 session store；可指定 sessionKey。
- **sessions.patch**：更新 displayName、channel、sendPolicy、thinkingLevel、contextTokens、totalTokens、model 等。
- **Session 过期**：由环境变量 SESSION_RESET_MODE（daily/idle/none）、SESSION_RESET_AT_HOUR、SESSION_IDLE_MINUTES 控制；过期后下次 agent 会新建 sessionId 并清空 transcript。
- **显式重置**：消息以 `/new` 或 `/reset` 开头时，强制新建 session 再执行，剩余内容作为新消息。

**agent / chat.send / agent.wait / chat.abort**：

- **agent**：params.message 必填；可选 sessionKey/sessionId、wait。不 wait 时返回 `{ runId }`，可通过 **agent.wait**（params.runId）等待结果；wait 时直接返回 `{ runId, text?, toolCalls? }`。
- **chat.send**：向指定 session 发送消息并执行 agent，直接返回 `{ text, toolCalls? }`。
- **chat.abort**：params.runId，中止该 runId 对应执行。
- **流式**：服务端广播 `agent.run.started`、`agent.run.chunk`、`agent.run.done`，客户端可订阅实现打字机效果。

## 五、node.invoke 流程

- 调用方发 **node.invoke**（指定 nodeId、参数）→ 服务端根据 nodeId 找到对应连接，向该连接推送 **node.invoke.request**（带唯一 id），并在 pendingInvokes 中挂起 Promise。
- 该连接（node 端）执行完后发 **node.invoke.result**（同一 id + result）→ 服务端 resolve 并将结果作为 node.invoke 的 response 回给调用方。
- 这样「推理在 agent、工具在本地/远程 Node」的语义成立；Gateway 只做转发与配对。

## 六、事件（服务端推送）

包括：health、cron、presence、agent、agent.run.started、agent.run.chunk、agent.run.done、node.invoke.request 等。客户端长连后可根据 event 订阅。

## 七、客户端用法示例

```ts
import { callGateway } from "@monou/gateway";

const jobs = await callGateway<{ jobs: unknown[] }>({
  url: "ws://127.0.0.1:18789",
  method: "cron.list",
  params: { includeDisabled: true },
});

// 带认证时需先 connect（长连场景下由 Control UI / TUI 等维护连接并发 connect）
```

## 八、安全与传输

- **认证**：GATEWAY_TOKEN 或 GATEWAY_PASSWORD 任一非空即启用；connect 时 params 带 token 或 password，服务端做 timing-safe 校验。
- **TLS**：GATEWAY_TLS_CERT、GATEWAY_TLS_KEY 指向证书与私钥文件路径时启用 wss。
- 可选扩展：Origin 校验、限流、方法级权限（未在本文档展开）。

## 九、扩展时注意点

- 新增 RPC：在 **packages/gateway** 的 `GATEWAY_METHODS` 增加方法名，在 **apps/gateway** 的 `createHandlers` 中实现；若需新依赖，在 context 或 HandlersContext 中注入。
- 会话与 transcript 已由 sessionStorePath 与 resolveSession 管理；若需 sessionKey → agentId 持久化绑定，可在 context 中扩展。
- Agent 执行：当前通过「已连接的 agent 进程」完成；若未来接入远程 Agent，可改为向某 connection 推送 agent.invoke 并收 agent.turn.result，或继续通过 node.invoke 将工具调用转到指定 Node。
