# @monou/gateway-app

monoU Gateway 服务端：常驻 WebSocket，提供 health、cron、agents、sessions、agent 执行、node.invoke（远程/本地工具转发）。

## 结构

- **packages/gateway**：协议类型与客户端 `callGateway`，供 CLI/TUI 调用网关。
- **apps/gateway**（本包）：服务端进程，依赖 `@monou/gateway`、`@monou/cron`、`@monou/agent-from-dir`（仅 skills.status 等只读能力）。**不**内嵌 agent 执行，仅转发给已连接的 agent 进程。

## 用法

### 1. 启动 Gateway

```bash
# 从 monorepo 根目录
npm run build
npm run gateway

# 或指定端口
GATEWAY_PORT=18790 npm run gateway
```

Gateway 只做控制面与转发；要执行 agent 对话需**单独启动 agent 进程**并连接本 Gateway（见下）。若未启动 agent 即调用 `agent` 或 `chat.send`，将返回 **501**，错误信息会提示「请先启动 agent（例如 npm run agent）并连接本 Gateway」。

### 2. 启动 Agent 连接 Gateway（必选，用于执行对话）

在**另一终端**或**另一机器**启动 agent 进程，连接同一 Gateway；可启动多个，用不同 `AGENT_ID`/`DEVICE_ID`：

```bash
# 终端 2：本机默认 .u agent
GATEWAY_URL=ws://127.0.0.1:18789 AGENT_ID=.u AGENT_DIR=./.u npm run agent

# 终端 3：再一个 agent，例如 A_agent
GATEWAY_URL=ws://127.0.0.1:18789 AGENT_ID=A_agent AGENT_DIR=./A_agent npm run agent

# 另一台机器
GATEWAY_URL=ws://192.168.1.100:18789 AGENT_ID=my_agent npm run agent
```

每个 agent 的 `AGENT_DIR` 需与 `.u` 同构（其下 `cron/`、`skills/` 等；会话由 Gateway 管理）。可在项目内复制 `.u` 为 `A_agent`、`B_agent` 再指定 `AGENT_DIR`。

环境变量：

- `GATEWAY_PORT`（默认 18789）、`GATEWAY_HOST`（默认 127.0.0.1）、`CRON_STORE`（默认 `./.u/cron/jobs.json`）
- **数据目录**：`GATEWAY_DATA_DIR` 或 `GATEWAY_STATE_DIR` 覆盖默认 `./.gateway`（与 OpenClaw 的 `~/.openclaw` 对应，但为项目内目录）
- **认证**：`GATEWAY_TOKEN` 或 `GATEWAY_PASSWORD` 任一非空即启用；客户端首条须为 `connect` 并带 `token`/`password`
- **TLS**：`GATEWAY_TLS_CERT`、`GATEWAY_TLS_KEY` 为证书与私钥文件路径时启用 wss
- **Session 过期（freshness）**：`SESSION_RESET_MODE`（`daily` | `idle` | `none`，默认 `none`）、`SESSION_RESET_AT_HOUR`（0–23，daily 时每日该点重置，默认 4）、`SESSION_IDLE_MINUTES`（idle 模式下闲置多少分钟后视为过期）

## 数据目录 ./.gateway

默认以启动时的 cwd 为基准，使用 `./.gateway` 存放 Gateway 自有数据（类似 OpenClaw 的 `~/.openclaw`）：

| 路径 | 说明 |
|------|------|
| `.gateway/mappings.json` | Connector 转发映射（connector.mapping.add/remove 持久化） |
| `.gateway/sessions/sessions.json` | Session 元数据（sessionKey → SessionEntry） |
| `.gateway/sessions/transcripts/*.json` | 所有会话的 transcript |

会话均由控制面管理，**所有会话都有 sessionKey**；不预置固定 key，未指定 sessionKey 时按时间新建（`agent:.u:s-<timestamp>-<random>`）。agent 目录（`.u`）不包含 chat.json，会话均在 Gateway 侧。Cron 仍使用 `./.u/cron/jobs.json`（或 `CRON_STORE`），本机 agent 工作区为 cwd 下的 `./.u`。

本机默认 agent 与存放其信息的文件夹同名，即 **`.u`**（其下 skill、cron、chat 等）；**deviceId** 固定为 `1270000001`，便于与远程 Node 区分；`agents.list` / `node.list` 中可见。

## 协议

1. **连接后首条可为 identity**：`{ "method": "connect", "params": { "role": "agent"|"node"|"operator", "agentId": "...", "deviceId": "...", "sessionKey": "..." }, "id": "1" }`。传 `sessionKey` 时该连接后续 agent/chat 未传 sessionKey 则用此值。
2. **RPC**：`{ "method": "cron.list", "params": {}, "id": "2" }` → `{ "id": "2", "ok": true, "payload": { "jobs": [...] } }`。

支持方法：`connect`、`health`、`status`、`cron.list`、`cron.status`、`cron.add`、`cron.update`、`cron.remove`、`cron.run`、`cron.runs`、`agents.list`、`sessions.list`、`sessions.preview`、`sessions.patch`、`agent`、`agent.wait`、`chat.history`、`chat.send`、`chat.abort`、`skills.status`、`node.list`、`node.invoke`、`node.invoke.result`、`connector.mapping.*`。

### Session 与对话

- **sessions.list / sessions.preview**：返回 session store；未指定 sessionKey 时按时间新建 key。
- **sessions.patch**：`params.sessionKey` 或 `params.sessionId` + `params.patch`，仅允许更新 `displayName`、`channel`、`sendPolicy`、`thinkingLevel`、`contextTokens`、`totalTokens`、`model`。
- **Session 过期**：由 `SESSION_RESET_MODE`（daily/idle/none）控制；daily 按 `SESSION_RESET_AT_HOUR` 每日重置，idle 按 `SESSION_IDLE_MINUTES` 闲置过期；过期后下次 agent 会新建 sessionId 并清空 transcript。
- **显式重置**：消息内容以 `/new` 或 `/reset` 开头时，强制新建 session 再执行，剩余内容作为新消息。

### agent、chat.send、agent.wait、chat.abort

- **agent**：`params.message`（必填）、`params.sessionKey`/`params.sessionId`（可选，默认主 session 或 connect 时的 sessionKey）、`params.wait`（可选，为 true 时阻塞直到该轮结束并返回完整结果）。返回 `{ runId, text?, toolCalls? }`；不 wait 时仅返回 `{ runId }`，可通过 **agent.wait**（`params.runId`）等待结果。
- **chat.send**：向指定 session 发送消息并执行 agent（与 agent 相同逻辑），无 runId/wait，直接返回 `{ text, toolCalls? }`。
- **chat.abort**：`params.runId`，中止该 runId 对应的正在执行的 agent 轮。
- **流式**：服务端会广播 `agent.run.started`、`agent.run.chunk`（每段文本）、`agent.run.done`，客户端可订阅实现打字机效果。

### 事件（服务端推送）

`health`、`cron`、`presence`、`agent`、`agent.run.started`、`agent.run.chunk`、`agent.run.done`、`node.invoke.request`。

## 以 Agent 身份注册到 Gateway（多 agent / 多目录）

若你有多个与 **`.u` 同构**的目录（例如复制 `.u` 为 `A_agent`，其下同样有 chat.json、cron/、skills/ 等），希望每个以独立 agentId 注册到同一 Gateway：

1. **目录结构**：`A_agent` 与 `./.u` **本身目录结构一致**（即 `A_agent/cron/`、`A_agent/skills/` 等；无 chat.json），不是「A_agent 下再套一层 .u」。
2. 启动一个 **Agent 客户端**进程，连接 Gateway 并声明 `role: "agent"`、`agentId`、`deviceId`；收到派发时在该目录下执行一轮对话并回传 `node.invoke.result`。

从 monorepo 根目录执行（需先 `npm run build`）：

```bash
# 终端 1：启动 Gateway
npm run gateway

# 终端 2：启动 A_agent（使用与 .u 同构的 ./A_agent 目录）
GATEWAY_URL=ws://127.0.0.1:18789 AGENT_ID=A_agent AGENT_DIR=./A_agent npm run agent

# 或直接 node（若在 apps/agent 下）
GATEWAY_URL=ws://127.0.0.1:18789 AGENT_ID=A_agent AGENT_DIR=/path/to/A_agent node apps/agent/dist/index.js
```

环境变量：

- **GATEWAY_URL**（必填）：Gateway WebSocket 地址。
- **AGENT_ID**（必填）：注册到 Gateway 的 agentId，Control UI / RPC 中可见。
- **AGENT_DIR**（可选）：该 agent 的目录，**与 .u 同构**（即目录结构同 `./.u`：其下 `cron/jobs.json`、`skills/`、`memory/` 等；会话在 Gateway）；未设则用 `cwd/.u`。兼容旧名 `AGENT_ROOT_DIR`。启动前可复制整个 `.u` 为 `A_agent` 再指定 `AGENT_DIR=./A_agent`。
- **DEVICE_ID**（可选）：设备标识，默认与 AGENT_ID 相同；Gateway 按 deviceId 聚合成 Node。
- **GATEWAY_TOKEN** / **GATEWAY_PASSWORD**（可选）：与 Gateway 认证一致时填写。

之后在 Control UI 的「对话」里选择 `A_agent` 并指定在该 Node 上执行，或通过 `agent` RPC 传 `agentId: "A_agent"`、`nodeId`/`deviceId` 派发到该进程。

## 远程 Agent + 本地工具

Node 连接时声明 `role: "node"`；其他客户端可 `node.invoke` 向该 node 发 `node.invoke.request` 事件；node 执行后发 `node.invoke.result`，Gateway 将结果回传给调用方。

## 与 OpenClaw 兼容子集

本 Gateway 在「多会话、Session 持久化、agent/chat RPC、事件」上与 OpenClaw 的 Gateway 子集对齐，便于复用客户端或迁移。主要能力：多会话 store、主 session、sessions.list/preview/patch、agent 按 session 执行并写回 transcript、chat.history/chat.send、Session 过期（daily/idle）与显式 /new、/reset、agent.runId + agent.wait + chat.abort、流式事件 agent.run.started/chunk/done、skills.status。差异与待办见 `docs/monou-vs-openclaw-improvements.md`。
