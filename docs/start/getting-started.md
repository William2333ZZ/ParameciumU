---
title: "快速开始"
summary: "在本地构建并运行 ParameciumU：Gateway、Agent、Control UI 或 TUI 的端到端步骤"
read_when:
  - 首次搭建本地环境
  - 需要启动 Gateway / Agent / Control UI / TUI 任一组件
  - 排查「连不上、对话没反应」时对照步骤
---

# 快速开始

本文档帮助你在本地构建并运行 ParameciumU：Gateway、Agent、Control UI 或 TUI。

## 前置要求

- **Node.js >= 20**
- 若使用 LLM：配置 `OPENAI_API_KEY` 或 `AIHUBMIX_API_KEY`、`AIHUBMIX_BASE_URL`（可复制根目录 `env.example` 为 `.env` 后填写，由 dotenv 加载）

## 一、构建

在 monorepo 根目录执行：

```bash
npm install
npm run build
```

构建顺序：packages（shared → agent-core → skills → cron → agent-sdk → agent-template → compaction → llm-provider → agent-from-dir → tui → gateway），然后 apps（gateway、agent）。control-ui 为 Vite 开发/构建，按需执行 `npm run control-ui` 或 `npm run control-ui:build`。

## 二、准备 Agent 目录（须显式指定）

无默认目录，启动 agent 时必须指定 **AGENT_DIR** 和 **AGENT_ID**。

若尚未有智能体目录：可从模板生成 `.first_paramecium`（与 `packages/agent-template/template` 同构，skills 与模板对齐），或复制已有 agent 目录（如 `agents/code_engineer`）后启动时传入该路径。

从模板生成（推荐，skills 与 template 一致）：

```bash
node -e "require('@monou/agent-template').ensureAgentDir({ rootDir: process.cwd() })"
```

或复制已有目录：`cp -r agents/code_engineer .first_paramecium`

## 三、启动 Gateway

终端 1：

```bash
npm run gateway
```

默认监听 `ws://127.0.0.1:9347`。可指定端口：`GATEWAY_PORT=18790 npm run gateway`。如需认证，设置 `GATEWAY_TOKEN` 或 `GATEWAY_PASSWORD`，连接时首条消息须为 connect 并带对应 token/password。

## 四、启动 Agent（执行对话所必需）

Gateway 只做路由与转发，不执行 agent。需在另一终端启动 agent 并连接同一 Gateway：

终端 2：

```bash
GATEWAY_URL=ws://127.0.0.1:9347 AGENT_ID=.first_paramecium AGENT_DIR=./.first_paramecium npm run agent
```

多 agent 时再开终端，换 `AGENT_ID` 与 `AGENT_DIR` 即可。

## 五、使用 Control UI（Web）

终端 3（或任意时刻，Gateway 与 Agent 已起即可）：

```bash
npm run control-ui
```

浏览器打开 http://localhost:5173，输入 Gateway URL（如 `ws://127.0.0.1:9347`）和可选 token/password 连接。连接后可看到节点/Agent、会话、Cron 等，并与 Agent 对话。

## 六、使用 TUI（终端）

若希望用终端 TUI 对话与管理 Cron，在 Gateway 与 Agent 已启动的前提下，可再运行：

```bash
npx u-tui
```

首屏为对话；输入 `/cron` 进入定时任务面板，`q` 退出 Cron 面板。TUI 连 Gateway，对话历史由 Gateway 会话管理（.gateway/sessions/transcripts/）。

## 七、飞书连接（可选）

1. 配置飞书应用与 WebSocket 等（见 `apps/feishu-app/env.example`）。
2. 启动 Gateway 与至少一个 agent。
3. 运行 feishu-app：`cd apps/feishu-app && npm run build && node dist/index.js`。
4. 在 Control UI 或通过 RPC 完成 connector 映射，将飞书会话映射到指定 agent/node。

## 八、沙箱 Node（可选）

若需在隔离环境执行 system.run / system.which（供 node.invoke 调用）：

```bash
GATEWAY_URL=ws://127.0.0.1:9347 SANDBOX_NODE_ID=sandbox-1 npm run sandbox-node
```

默认使用 Docker；设 `SANDBOX_USE_DOCKER=0` 可退化为本机子进程。

## 九、常用命令汇总

| 目的 | 命令 |
|------|------|
| 构建全量 | `npm run build` |
| 启动 Gateway | `npm run gateway` |
| 启动 Agent | `GATEWAY_URL=ws://127.0.0.1:9347 AGENT_ID=.first_paramecium AGENT_DIR=./.first_paramecium npm run agent` |
| 开发 Control UI | `npm run control-ui` |
| TUI（终端） | `npx u-tui` |
| 启动沙箱 Node | `GATEWAY_URL=... npm run sandbox-node` |

**说明**：定时任务（Cron）的**执行**内嵌在 Agent 进程中。启动 `npm run agent` 后，同一进程内会运行 runScheduler，到点自动执行 cron/jobs.json 中的任务（含 Heartbeat）。**无需**单独运行 `npm run cron:daemon`。`npm run cron:daemon` 为可选的独立调度器进程，仅推进任务时间戳、不执行 agent turn，仅在特殊场景需要。

## 下一步

- 整体架构与四层抽象：[架构](../concepts/architecture.md)
- Gateway 协议与会话：[Gateway](../gateway/protocol.md)
- 应用与环境变量：[apps](../runtime/apps.md)
- Agent 目录约定与 SOUL/skills：[Agent 目录](../concepts/agent-directory.md)
- 部署文档站：[部署说明](../deploy-docs-site.md)
