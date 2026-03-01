---
title: "Architecture"
summary: "ParameciumU: Hub (Gateway) at center; Agents and Nodes connect to it. Definition = agent folder. Connectors as nodes."
read_when:
  - First time understanding the project
  - Extending or integrating Gateway / Agent / Node
---

# ParameciumU architecture

Everything connects through one **Hub** (Gateway). What connects is either an **Agent** (runs turns and loads a **Definition**), a **Node** (exposes capabilities like browser, sandbox, or connector), or a **Client** (UI: Control UI, TUI). No “L1/L2/L3/L4” — just roles and one shared center. This aligns with **agent-creator**, **node-creator**, and **gateway_skill**, and with the [README](../../README.md) and [SOUL](../../.first_paramecium/SOUL.md) vision.

## Design principles

| Principle | Meaning |
|-----------|--------|
| **Definition = files** | An agent is a folder (SOUL, IDENTITY, skills, cron, memory, knowledge). Version it, move it; no lock-in. |
| **Hub routes, edge runs** | The Hub routes and pushes; it does not run LLM or cron. Sessions, memory, skills, and cron run in the Agent process. |
| **Data and soul in your dirs** | Identity, memory, knowledge live in directories you control. |
| **One role, one job** | Hub, Agent, Node, Client each have a clear responsibility; you can add or replace them. |
| **Self-evolution** | New agents and nodes are created by running agents (agent-creator, skill-creator, node-creator); no platform release needed. |

## The four roles

```
                         ┌─────────────────────────────────┐
                         │  Definition (agent folder)       │
                         │  SOUL · IDENTITY · skills/       │
                         │  memory/ · knowledge/ · cron/    │
                         └────────────────┬────────────────┘
                                           │ loaded by
         ┌─────────────────────────────────┼─────────────────────────────────┐
         │                            Hub (Gateway)                             │
         │               route · sessions · cron RPC · forward                  │
         │                         ws://127.0.0.1:9347                           │
         └───┬─────────────────────────────┬─────────────────────────────┬───┘
             │                             │                             │
        ┌────▼────┐                  ┌─────▼─────┐                  ┌─────▼─────┐
        │ Agent   │                  │ Node      │                  │ Client    │
        │ runner  │                  │ browser   │                  │ Control   │
        │ + def   │                  │ sandbox   │                  │ UI · TUI  │
        └─────────┘                  │ connector │                  └───────────┘
                                    └───────────┘
```

### Hub (Gateway)

The **only** center. One WebSocket server: connect, route, sessions, cron RPC, agent/chat forward, **node.invoke** forward. It does **not** run LLM, store SOUL/IDENTITY, or execute cron jobs. Default: `ws://127.0.0.1:9347`.

### Agent

A process that connects to the Hub with `role=agent`, loads **one Definition** (agent folder), and runs turns (LLM + tools), heartbeat, and in-process cron. One agent = one Definition + one runner process. The same Definition can run on your machine or on an **AI OS** device — same “body,” different runtime.

### Node

A process that connects to the Hub with `role=node`, declares `capabilities[]`, and handles `node.invoke.request`. Examples:

- **browser-node** — capabilities `["browser"]`; `browser_fetch`, `browser_click`, etc.
- **sandbox-node** — capabilities `["sandbox"]`; `system.run`, `system.which`.
- **Connector node** — capabilities like `["connector"]` or `["feishu"]`; receives inbound messages (e.g. Feishu), routes to Hub/agent, pushes replies. So **connector-style software is a Node**; over time, all “connector layer” can be node capabilities.

Agents call nodes via **gateway_node_invoke** (gateway_skill). No separate “L1” — UIs are **Clients** (operator); Feishu-style entry points are **Nodes** (connector).

### Client

Control UI, TUI, or any app that connects as `operator` (or similar) and uses the Hub only for RPC (sessions, chat, cron list, etc.). They do not run turns and do not handle node.invoke; they talk to the Hub, and the Hub talks to Agents and Nodes.

### Definition

The **agent folder**: SOUL.md, IDENTITY.md, skills/, memory/, knowledge/, cron/. The single source of truth for “who” the paramecium is. Any compatible runtime (today’s Agent runner, future AI OS) can load it. Not a “layer” — it’s the **content** an Agent loads.

**AI OS** — The same Definition can run on different runtimes. The “agent node” is the device or process running the Agent; AI OS is one such runtime.

## Repo and code layout

### Root

```
ParameciumU/
├── apps/              # gateway (Hub), agent (Agent), control-ui, TUI (Clients),
│                      # feishu-app, sandbox-node, browser-node (Nodes)
├── packages/          # shared, agent-core, skills, cron, gateway, agent-from-dir, …
├── agents/            # example agent dirs (same shape as .first_paramecium)
├── .first_paramecium/ # default “first paramecium” Definition (optional)
├── docs/
└── scripts/
```

### Packages (bottom-up)

| Role | Package | Purpose |
|------|---------|---------|
| Base | @monou/shared | Types, IDs, utils |
| Core | @monou/agent-core | State, messages, single-turn loop |
| Capability | @monou/skills, @monou/cron, @monou/llm-provider | Skills, cron store, LLM stream |
| Integration | @monou/agent-sdk | createAgent, runTurn, tools |
| Definition | @monou/agent-template | Template dir, ensureAgentDir, getAgentDir, getAgentSkillDirs |
| Load from dir | @monou/agent-from-dir | buildSessionFromU, createAgentContextFromU |
| Hub | @monou/gateway | Protocol types, callGateway, RPC/events |
| UI | @monou/tui | Terminal UI components |

### Apps by role

| App | Role | Notes |
|-----|------|--------|
| **gateway** | Hub | WebSocket server; connect, route, sessions, cron RPC, forward to Agents and Nodes. |
| **agent** | Agent | Connects to Hub, loads one Definition, runs runTurn, heartbeat, in-process cron. |
| **control-ui** | Client | Connects as operator; topology, sessions, chat. |
| **TUI (u-tui)** | Client | Terminal UI; connects to Hub. |
| **feishu-app** | Node (connector) | Connects as node/connector; Feishu messages → connector.message.inbound; pushes replies. |
| **sandbox-node** | Node | role=node, capabilities `["sandbox"]`; system.run, system.which. |
| **browser-node** | Node | role=node, capabilities `["browser"]`; browser_fetch, etc. |

Creating agents: **agent-creator** skill. Creating or starting nodes: **node-creator** skill. From an agent, talking to the Hub and nodes: **gateway_skill** (gateway_agents_list, gateway_nodes_list, gateway_node_invoke, sessions_*, send_message, etc.).

## Hub boundary

**Hub does:** WebSocket connect and identity (agent / node / operator); routing; session management; agent/chat.send/abort/wait and runId/stream events; cron list/add/update/remove/run; node.list and node.invoke forwarding; connector.mapping; auth, TLS, session expiry.

**Hub does not:** Run LLM or agent loop; store SOUL/IDENTITY/skills or user memory; execute cron (that’s in the Agent process).

## Definition checklist

| Item | Path / convention |
|------|-------------------|
| Soul | SOUL.md |
| Identity | IDENTITY.md |
| Skills | skills/&lt;name&gt;/ — SKILL.md, scripts/, references/ |
| Long-term memory | memory/, MEMORY.md |
| Knowledge | KNOWLEDGE.md, knowledge/ |
| Cron | cron/jobs.json — Gateway exposes cron.* RPC; execution in Agent |

Sessions live in the Hub (e.g. `.gateway/sessions/`), not in the Definition folder.  
Any folder that follows this convention is a **ParameciumU-compatible agent**; see [agent-directory.md](./agent-directory.md).

## Next steps

- [Agent directory](./agent-directory.md) — Definition layout, skills, memory, knowledge, cron.
- [Gateway protocol](../gateway/protocol.md) — connect, RPC, sessions, node.invoke.
- [Apps & runtime](../runtime/apps.md) — Hub, Agent, Nodes, Clients.
- [Agent running](../runtime/agent-running.md) — session, context, runTurn, heartbeat.
- [Getting started](../start/getting-started.md) — run the organism.
- [Vision & roadmap](./vision-and-roadmap.md) — product direction.
