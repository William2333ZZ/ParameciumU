---
title: "Getting started"
summary: "Build and run ParameciumU locally: Gateway, Agent, Control UI or TUI, step by step."
read_when:
  - First-time local setup
  - Starting Gateway / Agent / Control UI / TUI
  - Debugging connection or "no reply" issues
---

# Getting started

This doc walks you through building and running ParameciumU: Gateway, Agent, and Control UI or TUI. See [architecture.md](../concepts/architecture.md) for roles: Hub (Gateway), Agent, Node, Definition, Client.

## Prerequisites

- **Node.js >= 20**
- **LLM 配置**：在 **agent 目录** 下放 `llm.json`（OpenAI 兼容接口：apiKey、baseURL、model）。可从该目录的 `llm.json.example` 复制为 `llm.json` 并填写；未填写的项会从环境变量 `OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL` 补全。

## 1. Build

From the repo root:

```bash
npm install
npm run build
```

Build order: packages (shared → agent-core → skills → cron → agent-sdk → agent-template → llm-provider → agent-from-dir → tui → gateway), then apps (gateway, agent, etc.). Control UI is Vite: `npm run control-ui` (dev) or `npm run control-ui:build` (output in apps/control-ui/dist).

## 2. Agent directory (required for agent)

启动 agent 时**无默认值**，必须指定 **AGENT_DIR** 和 **AGENT_ID**；agent 完全由该目录加载（skills、SOUL/IDENTITY、**llm.json** 控制模型）。示例：`AGENT_ID=.first_paramecium AGENT_DIR=./.first_paramecium`，也可用 `agents/<id>/` 等任意同构目录。

从模板创建或复制已有目录（见下方命令）。从模板创建（推荐）：

```bash
node -e "require('@monou/agent-template').ensureAgentDir({ rootDir: process.cwd() })"
```

或复制已有：`cp -r agents/code_engineer .first_paramecium`

**LLM 配置**：在 agent 目录下添加 `llm.json`（可从 `llm.json.example` 复制）。格式：`{"apiKey":"...","baseURL":"...","model":"..."}`；任意 OpenAI 兼容代理（如 aihubmix、Kimi）均可通过 baseURL + apiKey + model 使用。

## 3. Start Gateway

Terminal 1:

```bash
npm run gateway
```

Default: `ws://127.0.0.1:9347`. Custom port: `GATEWAY_PORT=9348 npm run gateway`. For auth, set `GATEWAY_TOKEN` or `GATEWAY_PASSWORD`; clients must send connect with the same token/password.

## 4. Start Agent (required for chat)

Gateway only routes; it does not run the agent. Start the agent in another terminal and point it at the same Gateway. **LLM 从该 agent 目录下的 `llm.json` 读取**（见上文 Prerequisites / Agent directory）。

Terminal 2:

```bash
GATEWAY_URL=ws://127.0.0.1:9347 AGENT_ID=.first_paramecium AGENT_DIR=./.first_paramecium npm run agent
```

多 agent：开多个终端，每个设置不同的 `AGENT_ID` 和 `AGENT_DIR`，每个 agent 目录可有自己的 `llm.json`。

## 5. Control UI (web)

Terminal 3 (any time after Gateway and at least one agent are running):

```bash
npm run control-ui
```

Open http://localhost:5173, enter Gateway URL (e.g. `ws://127.0.0.1:9347`) and optional token/password. You can then see agents/nodes, sessions, cron, and chat with the agent.

## 6. TUI (terminal)

With Gateway and agent running:

```bash
npx u-tui
```

Main screen: chat. Type `/cron` for the cron panel; `q` to leave cron. TUI connects to Gateway; session history is in Gateway (e.g. .gateway/sessions/transcripts/).

## 7. Feishu (optional)

1. Configure the Feishu app and WebSocket (see `apps/nodes/feishu-node/env.example`).
2. Start Gateway and at least one agent.
3. Run feishu-node: `cd apps/nodes/feishu-node && npm run build && node dist/index.js` (or from repo root: `npm run feishu-node`).
4. In Control UI or via RPC, set up connector mapping so Feishu sessions map to the desired agent.

## 8. Nodes (optional)

**Sandbox node** (system.run / system.which in isolated workspace):

```bash
GATEWAY_URL=ws://127.0.0.1:9347 SANDBOX_NODE_ID=sandbox-1 npm run sandbox-node
```

Default uses Docker; set `SANDBOX_USE_DOCKER=0` for local subprocess.

**Browser node** (Playwright WebKit for browser_fetch, etc.):

```bash
# In apps/nodes/browser-node: npx playwright install webkit, npm run build
GATEWAY_URL=ws://127.0.0.1:9347 npm run browser-node
```

Agents use **gateway_skill** → **gateway_nodes_list** and **gateway_node_invoke** to call nodes. See [node-creator](../../.first_paramecium/skills/node-creator/SKILL.md) and [apps.md](../runtime/apps.md).

## 9. Command summary

| Goal | Command |
|------|---------|
| Full build | `npm run build` |
| Start Gateway | `npm run gateway` |
| Start Agent | `GATEWAY_URL=... AGENT_ID=.first_paramecium AGENT_DIR=./.first_paramecium npm run agent`（需在 AGENT_DIR 下配置 llm.json） |
| Control UI (dev) | `npm run control-ui` |
| TUI | `npx u-tui` |
| Sandbox node | `GATEWAY_URL=... npm run sandbox-node` |

**Cron:** Execution runs **inside the agent process**. After you start `npm run agent`, the same process runs runScheduler and executes cron/jobs.json (including Heartbeat) on schedule. You do **not** need `npm run cron:daemon` for normal use. `cron:daemon` is an optional separate process that only advances timestamps and does not run agent turns.

## Next steps

- [Architecture](../concepts/architecture.md)
- [Gateway protocol](../gateway/protocol.md)
- [Apps and env vars](../runtime/apps.md)
- [Agent directory](../concepts/agent-directory.md)
- [Deploy docs site](../deploy-docs-site.md)
