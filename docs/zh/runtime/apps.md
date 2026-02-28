# 应用

仓库中可直接运行的应用。实现细节见各应用源码。

## Gateway（`apps/gateway`）

- **运行**：根目录执行 `npm run gateway` → `node apps/gateway/dist/index.js`。
- **作用**：WebSocket 服务端；health、cron.*、connect、agents、sessions、agent、chat.*、node.*、connector.*。不运行 LLM；将 agent 运行请求转发给已连接的 Agent 进程。
- **环境变量**：`GATEWAY_PORT`、`GATEWAY_HOST`、`GATEWAY_DATA_DIR`、`CRON_STORE`、`GATEWAY_AGENT_HEARTBEAT_TIMEOUT_MS`、`GATEWAY_TOKEN`、`GATEWAY_PASSWORD`、`GATEWAY_TLS_CERT`、`GATEWAY_TLS_KEY`。
- **构建**：依赖 `@monou/gateway`、`@monou/cron`、`@monou/agent-from-dir`、`@monou/agent-sdk`、`@monou/shared`；在根目录执行 `npm run build`。

## Agent（`apps/agent`）

- **运行**：`GATEWAY_URL=... AGENT_ID=... AGENT_DIR=... npm run agent`。
- **作用**：以 `role: "agent"` 连接 Gateway，用 `agentId` 注册；收到 `node.invoke`（或内部 agent 调用）时通过 `buildSessionFromU` / `createAgentContextFromU` 加载智能体目录，用 `runAgentTurnWithTools` 执行一轮。同时运行 `AGENT_DIR/cron/jobs.json` 的 cron 调度器；首次连接时若不存在会创建默认 Heartbeat 任务。
- **环境变量**：`GATEWAY_URL` 或 `GATEWAY_WS_URL`、`AGENT_ID`、`AGENT_DIR`（必填）；可选 `DEVICE_ID`、`GATEWAY_TOKEN`、`GATEWAY_PASSWORD`。Heartbeat 相关：`HEARTBEAT_ACTIVE_HOURS_START`、`HEARTBEAT_ACTIVE_HOURS_END`、`HEARTBEAT_ACTIVE_HOURS_TZ`，以及 HEARTBEAT.md / HEARTBEAT_OK 行为（见应用源码）。
- **构建**：依赖 `@monou/agent-from-dir`、`@monou/agent-sdk`、`@monou/cron`、`@monou/shared`。

## Control UI（`apps/control-ui`）

- **运行**：`npm run control-ui`（Vite 开发服务器）；生产环境：用 workspace 脚本构建后托管构建产物。
- **作用**：Web UI，连接 Gateway（输入 WebSocket URL）、列出 agents/sessions、发送聊天消息、查看历史。使用 Gateway 协议（connect、chat.send、chat.history 等）。
- **配置**：Gateway URL 在界面中输入（如 `ws://127.0.0.1:9347`）。

## TUI（`apps/tui`）

- **运行**：`npm run tui` 或 `node apps/tui/dist/index.js`。
- **作用**：终端 UI，通过 Gateway 与 agent 对话（协议与 Control UI 相同，前端不同）。

## 其他应用

- **browser-node**：browser_skill 的无头浏览器节点（如 fetch、click、fill）。在配置后通过 Gateway 的 node.* 调用。
- **feishu-app**：飞书 connector 集成；见该应用目录及其中 env.example。
- **sandbox-node**：若栈中使用沙箱执行，见该应用目录。

以上均为 monorepo 一部分；构建顺序由根目录 `package.json` 与 workspace 依赖定义。
