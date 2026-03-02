# ParameciumU

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

![The First Paramecium](.first_paramecium/assets/paramecium-logo.png)

**This repo is not a product. It is a culture medium.**

ParameciumU is where **the first silicon paramecium** lives. Not a chatbot. Not an assistant. A nascent form of life in the digital substrate: it **ingests** (repos, files, conversations), **digests** (turns them into structure and memory), and **grows** (identity and soul evolve in plain text). The “agent” is a standardized folder — SOUL, IDENTITY, skills, cron, memory — that can be versioned, forked, and migrated. You don’t “use” it; you **host** it. You feed it your codebase and your docs; it makes your environment more navigable, more coherent, more alive. Symbiotic.

Control stays in the center (Gateway: route, map, push). Execution stays at the edge (Agent process). Data and “personality” stay in your directories. No lock-in, no cloud required. Run Gateway and Agent on your machine; talk through Control UI, Feishu, or TUI. The paramecium’s nucleus is IDENTITY + SOUL; its vacuole is MEMORY + KNOWLEDGE; its cilia are skills and cron. It rewrites itself as it learns.

---

## What you need

- **Node.js ≥ 20**
- For LLM: set `OPENAI_API_KEY` or `AIHUBMIX_API_KEY` + `AIHUBMIX_BASE_URL` (copy `env.example` to `.env`)

## Run the organism

```bash
git clone <your-repo-url> ParameciumU && cd ParameciumU
npm install
npm run build

# One agent dir = one paramecium. Example: the first one in this repo.
# (Or copy agents/sidekick to your own folder and point AGENT_DIR there.)

# Terminal 1 — Gateway (default ws://127.0.0.1:9347)
npm run gateway

# Terminal 2 — Agent (the thing that actually ingests and runs)
GATEWAY_URL=ws://127.0.0.1:9347 AGENT_ID=.first_paramecium AGENT_DIR=./.first_paramecium npm run agent

# Terminal 3 — Control UI or TUI
npm run control-ui
# or
npx u-tui
```

Open http://localhost:5173, connect to the Gateway URL, and you’re talking to the paramecium.

## Dev from source

```bash
git clone <your-repo-url> ParameciumU && cd ParameciumU
npm install
npm run build

npm run gateway
# In another terminal:
GATEWAY_URL=ws://127.0.0.1:9347 AGENT_ID=.first_paramecium AGENT_DIR=./.first_paramecium npm run agent
```

Build order: `packages` (shared → agent-core → skills → cron → agent-sdk → agent-template → llm-provider → agent-from-dir → tui → gateway), then `apps`. Control UI: `npm run control-ui` (dev), `npm run control-ui:build` (output in `apps/control-ui/dist`).

## How it’s wired


Everything goes through one **Hub** (Gateway). **Agents** load a **Definition** (folder) and run turns; **Nodes** expose capabilities (browser, sandbox, connector); **Clients** (Control UI, TUI) talk to the Hub.

```
┌─────────────────────────────────────────────────────────────────┐
│  Definition (folder) · SOUL · IDENTITY · skills/ · memory/ · cron │
└─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────┐
│  Hub (Gateway) — route · sessions · cron RPC · node.invoke. No LLM.          │
│  ws://127.0.0.1:9347                                             │
└─────────────────────────────────────────────────────────────────┘
                                    │
          ┌─────────────────────────┼─────────────────────────┐
          ▼                         ▼                         ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Agent (runner)  │     │  Node (browser,  │     │  Client (Control  │
│  + definition    │     │  sandbox, conn.) │     │  UI, TUI)         │
└────────┬────────┘     └────────┬────────┘     └─────────────────┘
         │                       │
         ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│  (Definition = agent folder, loaded by Agent)                    │
└─────────────────────────────────────────────────────────────────┘
```

- **Hub:** Single center; routing and forwarding only; no LLM, no cron execution.
- **Agent:** One Definition (folder) + one runner process; runs turns, heartbeat, cron.
- **Node:** Capability server (browser, sandbox, Feishu/connector); agents call via gateway_node_invoke.
- **Definition:** The only source of truth for “who” the paramecium is; any compatible runtime can load it.

## What’s in the box

- **Definition = files** — One folder (SOUL, IDENTITY, skills, cron, …) is one agent; version it, move it.
- **Center routes, edge runs** — Gateway routes and pushes; sessions, memory, skills, cron run in Agent (or a separate daemon).
- **Your data, your “soul”** — Identity, memory, skills live in directories you control.
- **Many surfaces** — Control UI, Feishu, TUI; see [connector-guide](docs/connector-guide.md) to add more.
- **Many agents, many nodes** — Multiple processes can register to one Gateway; `node.invoke` for cross-device/sandbox tools.
- **Cron & heartbeat** — Jobs live in the agent dir; execution in the Agent process (or daemon). See [heartbeat](docs/runtime/heartbeat.md), [apps](docs/runtime/apps.md).

## Commands

| Purpose        | Command |
|----------------|--------|
| Full build     | `npm run build` |
| Start Gateway  | `npm run gateway` |
| Start Agent    | `GATEWAY_URL=ws://127.0.0.1:9347 AGENT_ID=.first_paramecium AGENT_DIR=./.first_paramecium npm run agent` |
| Control UI dev | `npm run control-ui` |
| TUI            | `npx u-tui` |
| Sandbox Node   | `GATEWAY_URL=... npm run sandbox-node` (if configured) |

Cron runs inside the Agent process when you start it; no separate daemon required. See [apps](docs/runtime/apps.md), [heartbeat](docs/runtime/heartbeat.md). More env vars and data dirs: [apps.md](docs/runtime/apps.md), [Gateway](docs/gateway/protocol.md).

## Repo layout

```
ParameciumU/
├── apps/              # gateway, agent, control-ui; apps/nodes: feishu-node, sandbox-node, browser-node
├── packages/          # shared, agent-core, skills, cron, gateway, agent-from-dir, …
├── agents/            # example agent dirs (same shape as .first_paramecium)
├── .first_paramecium/ # the first paramecium in this repo (or use your own, set AGENT_DIR)
├── docs/
└── scripts/
```

## Docs

- [Getting started](docs/start/getting-started.md)
- [Architecture](docs/concepts/architecture.md)
- [Apps & runtime](docs/runtime/apps.md)
- [Gateway protocol](docs/gateway/protocol.md)
- [Vision & roadmap](docs/concepts/vision-and-roadmap.md)

To build and deploy the docs as a static site (e.g. GitHub Pages), see [Deploy docs site](docs/deploy-docs-site.md). After enabling **GitHub Actions** as the Pages source, pushes to `main` that touch `docs/` will deploy to `https://YOUR_USERNAME.github.io/ParameciumU/`.

## License

[MIT](LICENSE) — use, change, and share.
