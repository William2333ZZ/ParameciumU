# 快速开始

## 环境要求

- **Node.js ≥ 20**
- 使用 LLM 时：配置 `OPENAI_API_KEY` 或 `AIHUBMIX_API_KEY`、`AIHUBMIX_BASE_URL`（可将仓库根目录的 `env.example` 复制为 `.env`）

## 构建

在仓库根目录执行：

```bash
git clone <your-repo-url> ParameciumU && cd ParameciumU
npm install
npm run build
```

构建会按顺序编译 shared、agent-core、skills、cron、agent-sdk、agent-template、llm-provider、agent-from-dir、tui、gateway 及各 app（gateway、agent）。顺序由根目录 `package.json` 的 `build` 脚本规定。

## 准备智能体目录

**没有默认智能体目录**，必须显式创建或复制一个并传入。

使用默认模板（第一只草履虫结构）：

```bash
cp -r packages/agent-template/template .first_paramecium
# 或在脚本中调用：ensureAgentDir({ rootDir: process.cwd() })（来自 @monou/agent-template）
```

模板包含 `IDENTITY.md`、`SOUL.md`、`MEMORY.md`、`KNOWLEDGE.md`、`skills/`（base_skill、code_skill、todo_skill、memory、knowledge、cron 等）以及 `cron/jobs.json`。详见 [智能体目录](../concepts/agent-directory.md)。

## 运行 Gateway

在仓库根目录（或你用作「工作区根」的目录，默认 cron 存储基于此）执行：

```bash
npm run gateway
```

- 默认监听 `ws://127.0.0.1:9347`。
- 环境变量：`GATEWAY_PORT`、`GATEWAY_HOST`、`GATEWAY_DATA_DIR`（或 `GATEWAY_STATE_DIR`）、`CRON_STORE`、`GATEWAY_TOKEN` / `GATEWAY_PASSWORD`、`GATEWAY_TLS_CERT` / `GATEWAY_TLS_KEY`。详见 [Gateway](../concepts/gateway.md) 与 [参考 / 环境变量](../reference/env.md)。

## 运行 Agent

在另一终端中，指定 Gateway 与一个智能体目录：

```bash
export GATEWAY_URL=ws://127.0.0.1:9347
export AGENT_ID=.first_paramecium
export AGENT_DIR=./.first_paramecium
npm run agent
```

- `GATEWAY_URL` 或 `GATEWAY_WS_URL`：Gateway 的 WebSocket 地址。
- `AGENT_ID`：该智能体的唯一 id（如 `.first_paramecium`）。
- `AGENT_DIR`：智能体目录的绝对或相对路径（无默认值）。

可选：`DEVICE_ID`、`GATEWAY_TOKEN`、`GATEWAY_PASSWORD`。Agent 连接后以 `role: "agent"` 注册，在 Gateway 下发 `node.invoke`（如来自 Control UI）时执行回合。同时运行本地 cron 调度器，任务存储在 `AGENT_DIR/cron/jobs.json`。首次连接时若不存在会创建默认 Heartbeat 任务。

## 运行 Control UI

```bash
npm run control-ui
```

然后打开 http://localhost:5173，输入 Gateway URL（如 `ws://127.0.0.1:9347`），连接后即可对话。UI 通过 Gateway 协议（`chat.send`、`chat.history` 等）与后端通信。

## 运行 TUI

```bash
npm run tui
# 或：node apps/tui/dist/index.js
```

同样需要配置 Gateway URL 与智能体，在终端内对话。

## 小结

1. **构建**：执行一次 `npm run build`。
2. **创建智能体目录**：如 `.first_paramecium`，可从模板复制或自建。
3. **启动 Gateway**：`npm run gateway`。
4. **启动 Agent**：设置 `GATEWAY_URL`、`AGENT_ID`、`AGENT_DIR` 后执行 `npm run agent`。
5. **打开 Control UI**：`npm run control-ui`，在浏览器中连接 Gateway。

文档内容以代码为准；环境变量与协议细节见 [参考](../reference/env.md)。
