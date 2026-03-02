---
title: "Apps"
summary: "gateway, agent, control-ui, TUI, feishu-node, sandbox-node, browser-node: roles, how to run, env vars."
read_when:
  - Starting or debugging an app
  - Configuring port, auth, or data dirs
---

# Apps

This doc describes each runnable app under `apps/`: role, how to run, and main env vars. Each app can be built and run independently. The architecture is in [architecture.md](../concepts/architecture.md): Hub (Gateway), Agent, Node (including connector-style nodes like Feishu), Definition, Client.

## 1. gateway (@monou/gateway-app)

**Role:** Hub. WebSocket server for health, cron.*, connect, agents, sessions, agent/chat, node.*, connector.mapping.*, connector.message.*. **Does not run agent turns**; forwards to connected agent processes.

**Run:**

```bash
# From repo root
npm run build
npm run gateway

# Custom port
GATEWAY_PORT=9348 npm run gateway
```

**Env vars:**

| Var | Purpose | Default |
|-----|---------|---------|
| GATEWAY_PORT | Port | 9347 |
| GATEWAY_HOST | Bind address | 127.0.0.1 |
| GATEWAY_DATA_DIR / GATEWAY_STATE_DIR | Data dir (mappings, sessions) | ./.gateway |
| CRON_STORE | Cron store path | ./.first_paramecium/cron/jobs.json |
| GATEWAY_TOKEN / GATEWAY_PASSWORD | Auth; connect must send token or password if set | — |
| GATEWAY_TLS_CERT / GATEWAY_TLS_KEY | TLS cert and key paths (wss) | — |
| SESSION_RESET_MODE | daily \| idle \| none | none |
| SESSION_RESET_AT_HOUR | Hour for daily reset (0–23) | 4 |
| SESSION_IDLE_MINUTES | Idle minutes before expiry (idle mode) | — |

**Data dir ./.gateway:** `mappings.json`, `sessions/sessions.json`, `sessions/transcripts/*.json`.

Start at least one **agent** and connect it to this Gateway before using agent/chat.send; otherwise you get 501. See [protocol.md](../gateway/protocol.md).

---

## 2. agent (@monou/agent)

**Role:** Agent. Connects to Hub with role=agent, runs runTurn (LLM + tools), in-process cron, heartbeat. Loads one Definition (agent dir) via agent-from-dir.

**Run:**

```bash
# Terminal 2 (Gateway already running; set AGENT_DIR and AGENT_ID)
GATEWAY_URL=ws://127.0.0.1:9347 AGENT_ID=.first_paramecium AGENT_DIR=./.first_paramecium npm run agent

# Multiple agents
GATEWAY_URL=ws://127.0.0.1:9347 AGENT_ID=research_agent AGENT_DIR=./agents/research_agent npm run agent
```

**Env vars:**

| Var | Purpose | Required |
|-----|---------|----------|
| GATEWAY_URL | Gateway WebSocket URL | Yes |
| AGENT_ID | agentId registered with Gateway | Yes |
| AGENT_DIR / AGENT_ROOT_DIR | Agent dir (same shape as .first_paramecium) | Yes |
| DEVICE_ID | Device id (default hostname or AGENT_ID) | No |
| GATEWAY_TOKEN / GATEWAY_PASSWORD | Match Gateway auth | No |

**LLM 配置**：从 **agent 目录** 的 `llm.json` 读取（OpenAI 兼容：apiKey、baseURL、model）。可复制该目录下的 `llm.json.example` 为 `llm.json` 并填写；缺项时回退到环境变量 OPENAI_API_KEY、OPENAI_BASE_URL、OPENAI_MODEL。

**Behavior:** After connect, ensures a **Heartbeat** cron job exists and starts the in-process scheduler. Cron runs inside this process (runScheduler + onJobDue); no separate cron:daemon needed for executing turns. See [heartbeat.md](./heartbeat.md), [automation/heartbeat.md](../automation/heartbeat.md).

---

## 3. control-ui (@monou/control-ui)

**Role:** Web client. Connects to Gateway as operator; topology (agents, nodes), sessions, cron, settings, chat.

**Run:**

```bash
npm run control-ui
# or
cd apps/control-ui && npm run dev
```

Open http://localhost:5173, enter Gateway URL (e.g. ws://127.0.0.1:9347) and optional token/password. Start Gateway and at least one agent first.

**Build:** `npm run control-ui:build` → `apps/control-ui/dist`.

**Stack:** TypeScript, React, Vite; WebSocket to Gateway (@monou/gateway protocol).

---

## 4. TUI (@monou/u-tui)

**Role:** Terminal client. Chat + cron panel; uses agent-from-dir and AGENT_DIR; needs Gateway and agent running. Main screen: chat; /cron for cron; q to leave cron panel.

**Run:**

```bash
npm run build
npx u-tui
```

**Features:** Cron panel (.first_paramecium/cron/jobs.json, ↑↓ Enter); Chat panel (Gateway, streaming, /clear, /help, /cron, !cmd). Non-TTY prints usage and exits.

**Deps:** @monou/agent-from-dir, @monou/cron, @monou/tui, @monou/agent-sdk, @monou/llm-provider. LLM: OPENAI_API_KEY or AIHUBMIX_*.

---

## 5. feishu-node (@monou/feishu-node)

**Role:** Node (connector + node). Connects to Hub as **node** (`capabilities: ["feishu"]`) and as **connector**; receives Feishu WebSocket messages → connector.message.inbound; sends replies back to Feishu; supports connector.message.push; exposes `feishu.send` via node.invoke.

**Run:** From repo root: `npm run feishu-node`. Or `cd apps/nodes/feishu-node && npm run build && npm start`. Configure .env (see `apps/nodes/feishu-node/env.example`). Gateway must be running; complete connector mapping in Control UI or RPC.

**Env:** FEISHU_APP_ID, FEISHU_APP_SECRET, GATEWAY_WS_URL / GATEWAY_URL; optional FEISHU_NODE_ID (default feishu-1), FEISHU_DOMAIN (lark for international), CONNECTOR_ID, CONNECTOR_DISPLAY_NAME.

---

## 6. sandbox-node (@monou/sandbox-node)

**Role:** Node. Connects with role=node, capabilities `["sandbox"]`; runs system.run, system.which in an isolated workspace; target of node.invoke. Start via **node-creator** scripts or directly.

**Run:**

```bash
GATEWAY_URL=ws://127.0.0.1:9347 SANDBOX_NODE_ID=sandbox-1 SANDBOX_WORKSPACE=./.sandbox npm run sandbox-node
```

**Env:**

| Var | Purpose | Default |
|-----|---------|---------|
| GATEWAY_URL | Gateway WebSocket URL | Required |
| SANDBOX_NODE_ID | nodeId in node.list | sandbox-1 |
| SANDBOX_WORKSPACE | Workspace for commands | os.tmpdir()/paramecium-u-sandbox-&lt;nodeId&gt; |
| SANDBOX_USE_DOCKER | 1=Docker, 0=subprocess | 1 |
| SANDBOX_IMAGE | Docker image | debian:bookworm-slim |
| GATEWAY_TOKEN / GATEWAY_PASSWORD | Optional auth | — |

---

## 7. browser-node (@monou/browser-node)

**Role:** Node. Connects with role=node, capabilities `["browser"]`; Playwright WebKit for browser_fetch, browser_click, browser_fill, browser_links, browser_screenshot, browser_pages, browser_switch, browser_new_tab. Agents call it via **gateway_node_invoke** (gateway_skill).

**Run:**

```bash
# Install WebKit: npx playwright install webkit
cd apps/nodes/browser-node && npm run build
GATEWAY_URL=ws://127.0.0.1:9347 npm run browser-node
# Or from root (after build): GATEWAY_URL=ws://127.0.0.1:9347 npm run browser-node
```

**Env:**

| Var | Purpose | Default |
|-----|---------|---------|
| GATEWAY_URL | Gateway WebSocket URL | Required |
| BROWSER_NODE_ID | nodeId in node.list | browser-1 |
| BROWSER_HEADED | 1=headed window | 0 |
| BROWSER_USER_DATA_DIR | Profile dir (persist login) | — |
| GATEWAY_TOKEN / GATEWAY_PASSWORD | Optional auth | — |

**Protocol:** node.invoke commands: browser_fetch, browser_links, browser_click, browser_fill, browser_screenshot, browser_pages, browser_switch, browser_new_tab. Use **gateway_nodes_list** then **gateway_node_invoke(nodeId, command, params)** from gateway_skill. See [node-creator](../../.first_paramecium/skills/node-creator/SKILL.md).

---

## Scripts (root package.json)

| Purpose | Command |
|---------|---------|
| Gateway | `npm run gateway` |
| Agent | `GATEWAY_URL=... AGENT_ID=... AGENT_DIR=... npm run agent` |
| Browser node | `GATEWAY_URL=... npm run browser-node` (build and install webkit in app first) |
| Sandbox node | `GATEWAY_URL=... npm run sandbox-node` |
| Control UI dev | `npm run control-ui` |
| TUI | `npx u-tui` |

**Build:** From root, `npm run build` builds packages in order, then TUI, agent, sandbox-node, gateway.

## Next steps

- [Gateway protocol](../gateway/protocol.md)
- [Architecture](../concepts/architecture.md)
- [Agent directory](../concepts/agent-directory.md)
- [Control UI design](../control-ui/design.md)
- [Getting started](../start/getting-started.md)
