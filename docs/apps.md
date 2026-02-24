# apps 应用说明

本文档说明 `apps/` 下各可执行应用的职责、运行方式与环境变量。每个应用均可独立 build/run。monoU 协议与实现独立，不依赖 OpenClaw；扩展新 Connector 见 [connector-guide.md](./connector-guide.md)。

## 1. gateway（@monou/gateway-app）

**职责**：L2 控制面服务端。常驻 WebSocket，提供 health、cron.*、connect、agents、sessions、agent、chat.*、node.*、connector.mapping.* 等 RPC；**不内嵌 agent 执行**，仅将 agent/chat 请求转发给已连接的 agent 进程。

**运行**：

```bash
# 从 monorepo 根目录
npm run build
npm run gateway

# 或指定端口
GATEWAY_PORT=18790 npm run gateway
```

**环境变量**：

| 变量 | 说明 | 默认 |
|------|------|------|
| GATEWAY_PORT | 监听端口 | 9347 |
| GATEWAY_HOST | 监听地址 | 127.0.0.1 |
| GATEWAY_DATA_DIR / GATEWAY_STATE_DIR | 数据目录（mappings、sessions） | ./.gateway |
| CRON_STORE | cron 任务存储路径 | ./.u/cron/jobs.json |
| GATEWAY_TOKEN / GATEWAY_PASSWORD | 认证；任一非空即启用，connect 时必带 | - |
| GATEWAY_TLS_CERT / GATEWAY_TLS_KEY | TLS 证书与私钥文件路径，启用 wss | - |
| SESSION_RESET_MODE | daily \| idle \| none | none |
| SESSION_RESET_AT_HOUR | daily 时每日重置小时（0–23） | 4 |
| SESSION_IDLE_MINUTES | idle 时闲置多少分钟过期 | - |

**数据目录 ./.gateway**：`mappings.json`（Connector 映射）、`sessions/sessions.json`（会话元数据）、`sessions/transcripts/*.json`（会话记录）。

执行对话前需**单独启动 agent** 并连接本 Gateway，否则 agent/chat.send 会返回 501。详见 [gateway.md](./gateway.md)。

---

## 2. agent（@monou/agent）

**职责**：启动 Agent 的 app。连接 Gateway、以 role=agent 注册、接收 node.invoke.request（__agent=true）或 cron 到点派发，用 agent-from-dir 加载目录、执行 runTurn、回传 node.invoke.result 或 connector.message.push。

**运行**：

```bash
# 终端 2（Gateway 已启动）
GATEWAY_URL=ws://127.0.0.1:9347 AGENT_ID=.u AGENT_DIR=./.u npm run agent

# 多 agent 示例
GATEWAY_URL=ws://127.0.0.1:9347 AGENT_ID=A_agent AGENT_DIR=./A_agent npm run agent
```

**环境变量**：

| 变量 | 说明 | 必填 |
|------|------|------|
| GATEWAY_URL | Gateway WebSocket 地址 | 是 |
| AGENT_ID | 注册到 Gateway 的 agentId | 是 |
| AGENT_DIR / AGENT_ROOT_DIR | 与 .u 同构的 agent 目录 | 否，默认 cwd/.u |
| DEVICE_ID | 设备标识，Gateway 按此聚合 Node | 否，默认 hostname 或 AGENT_ID |
| GATEWAY_TOKEN / GATEWAY_PASSWORD | 与 Gateway 认证一致时填写 | 否 |

**行为**：连接成功后自动确保 cron store 中存在 Heartbeat 任务（默认禁用）；可配置 HEARTBEAT_ACTIVE_HOURS_*、HEARTBEAT.md 等。Cron 到点由本进程内 runScheduler 的 onJobDue 执行 runTurn，可选 push 到 connector。

---

## 3. control-ui（@monou/control-ui）

**职责**：L1 Connector（Web）。连接 Gateway，管理节点/Agent、会话、Cron、设置；与 Agent 对话。

**运行**：

```bash
# 根目录
npm run control-ui
# 或
cd apps/control-ui && npm run dev
```

浏览器打开 http://localhost:5173，输入 Gateway URL（如 `ws://127.0.0.1:9347`）和可选 token/password 连接。需先启动 Gateway 与至少一个 agent。

**构建**：`npm run control-ui:build`，产物在 `apps/control-ui/dist`。

**技术**：TypeScript + React + Vite；WebSocket 直连 Gateway，协议与 @monou/gateway 一致。

---

## 4. TUI（@monou/u-tui）

**职责**：L1 Connector（TUI）。终端内对话 + Cron 面板；使用 agent-from-dir 与 .u 持久化（与 `npm run u` 一致）。首屏为对话，/cron 进入定时任务，q 在 Cron 面板退出。

**运行**：

```bash
npm run build
npx u-tui
```

**功能**：Cron 面板（.u/cron/jobs.json，↑↓ 选择、Enter 菜单）；Chat 面板（连 Gateway、流式输出、会话由 Gateway 管理、/clear、/help、/cron、!cmd 等）。非 TTY 会打印用法并退出。

**依赖**：@monou/agent-from-dir、@monou/cron、@monou/tui、@monou/agent-sdk、@monou/llm-provider、chalk、dotenv。LLM 使用 OPENAI_API_KEY 或 AIHUBMIX_*。

---

## 5. feishu-app（@monou/feishu-app）

**职责**：L1 Connector（飞书）。长连 Gateway 为 Connector，连飞书 WebSocket 收消息 → 调 connector.message.inbound → 把回复发回飞书；支持接收 connector.message.push 主动推送并发到飞书对应会话。

**运行**：配置 .env（见 env.example），然后 `npm run build`、`node dist/index.js` 或 `npm run start`。需 Gateway 已启动，并在 Control UI 或 RPC 中完成 connector 映射。

**环境变量**（见 `apps/feishu-app/env.example`）：`FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`GATEWAY_WS_URL`（Gateway WebSocket 地址）；可选 `FEISHU_DOMAIN`（国际版填 lark）、`CONNECTOR_ID`、`CONNECTOR_DISPLAY_NAME`。

---

## 6. sandbox-node（@monou/sandbox-node）

**职责**：L3 Node（沙箱）。以 role=node 连接 Gateway，声明 capabilities: ["sandbox"]，在隔离 workspace 内执行 system.run / system.which；供 node.invoke 定向调用。

**运行**：

```bash
GATEWAY_URL=ws://127.0.0.1:9347 SANDBOX_NODE_ID=sandbox-1 SANDBOX_WORKSPACE=./.sandbox npm run sandbox-node
```

**环境变量**：

| 变量 | 说明 | 默认 |
|------|------|------|
| GATEWAY_URL | Gateway WebSocket 地址 | 必填 |
| SANDBOX_NODE_ID | 本节点 ID（node.list 可见） | sandbox-1 |
| SANDBOX_WORKSPACE | 沙箱工作目录 | os.tmpdir()/monou-sandbox-<nodeId> |
| SANDBOX_USE_DOCKER | 1= Docker 执行，0= 本机子进程 | 1 |
| SANDBOX_IMAGE | Docker 镜像 | debian:bookworm-slim |
| GATEWAY_TOKEN / GATEWAY_PASSWORD | 可选认证 | - |

---

## 脚本入口（根 package.json）

- `npm run gateway` → 启动 apps/gateway
- `npm run agent` → 启动 apps/agent
- `npm run sandbox-node` → 启动 apps/sandbox-node
- `npm run control-ui` → 开发 apps/control-ui（Vite）
- `npm run u` → scripts/run-u.ts（本机 .u 对话，不接 Gateway）
- `npx u-tui` → TUI（终端对话 + Cron）

构建：根目录 `npm run build` 按顺序构建各 package 再构建 TUI（u-tui）、agent、sandbox-node、gateway。
