---
title: "Vision and roadmap"
summary: "ParameciumU positioning, design principles, capability plan. Connector-layer as nodes; no OpenClaw dependency."
read_when:
  - Understanding product boundaries and roadmap
  - Doing architecture or capability planning
---

# ParameciumU vision and roadmap

This doc states ParameciumU’s positioning, design principles, and capability roadmap. **ParameciumU does not depend on OpenClaw** and does not aim for “OpenClaw protocol subset”; it is an independent stack that covers and exceeds comparable capabilities.

## Positioning

- **ParameciumU** — Sovereign agent product centered on **agent definition as a folder** (Definition). Same definition runs across runtimes; control plane (Gateway) is separate from execution (Agent + Nodes); data and “soul” stay in the user’s dirs.
- **Protocol and implementation** — Own Gateway protocol and implementation (packages/gateway + apps/gateway); evolution follows ParameciumU needs only.
- **Goal** — Clear architecture, extensibility, data sovereignty, multi-surface access, and automation that **exceed** comparable solutions, not follow them.

## Relation to OpenClaw

| Aspect | Stance |
|--------|--------|
| **Dependency** | No dependency on OpenClaw code or runtime. |
| **Protocol** | Not designed as an “OpenClaw subset.” Overlap (connect, cron.*, connector.message) is by design choice; we can change or extend anytime. |
| **Capabilities** | Use OpenClaw’s capability set as **planning reference** only: ensure ParameciumU covers or exceeds connection layer, scheduling, multi-agent, nodes, etc. |

**Conclusion:** ParameciumU covers and exceeds what OpenClaw represents, without aligning to its protocol or implementation.

## Design principles

(See [architecture.md](./architecture.md).)

| Principle | Meaning |
|------------|---------|
| **Definition = files** | Agent = folder (SOUL, IDENTITY, skills, cron, memory, knowledge); versionable, movable, no cloud lock-in. |
| **Center routes, edge runs** | Gateway routes and pushes; sessions, memory, skills, cron run in Agent (or daemon). |
| **Data and soul in your dirs** | Identity, memory, knowledge in dirs you control. |
| **One layer, one job** | Single responsibility per layer; swappable and extensible. |
| **Self-evolution in-product** | New agents and skills created by running agents (agent-creator, skill-creator, node-creator); no platform release needed. |
| **Protocol serves the product** | Gateway protocol serves ParameciumU; simple and evolvable. |
| **Connector-layer as nodes** | Connector-style software (Feishu, future WeCom, API) can be implemented as **nodes** (role=node, capabilities e.g. connector/feishu). So “connector-style entry points” become node capabilities over time. |

## Capability areas (planning reference)

### Connection / connector layer

| Area | Status | Plan |
|------|--------|------|
| Web client | ✅ control-ui | Keep improving topology and UX |
| Feishu | ✅ feishu-node (connector + node) | Optional: multi-instance, mapping UX |
| TUI | ✅ u-tui | Chat + cron panel |
| WeCom / DingTalk / API | Not yet | Add as connector nodes (same pattern: connect, inbound/push, mapping) |

**Design:** All connector-layer apps connect to Gateway (as operator/client or as node with connector capability). Inbound: connector.message.inbound; push: connector.message.push; mapping: connector.mapping.*. See [architecture](./architecture.md).

### Control plane (Hub)

| Area | Status | Plan |
|------|--------|------|
| Routing and sessions | ✅ sessions.*, connector.mapping | Session expiry, labels, archive as needed |
| Auth and security | ✅ GATEWAY_TOKEN/PASSWORD, TLS | Optional: method-level auth, rate limit, audit |
| Cron RPC | ✅ cron.*, store in agent dir | Execution in Agent; deliver to connector |
| Push | ✅ connector.message.push | Unified: Gateway → connector → channel |
| Multi-agent / multi-node | ✅ agents.list, node.list, node.invoke | Optional: agent groups, routing policy |

**Design:** Gateway does not run LLM, does not execute cron, does not store soul or memory; only route, map, RPC, push, and forward.

### Execution (Agent + Node)

| Area | Status | Plan |
|------|--------|------|
| Agent process | ✅ apps/agent, connect to Gateway | Optional: remote agent, multi-machine |
| Cron execution | ✅ runScheduler + onJobDue in agent; optional cron:daemon | deliver → connector.message.push |
| Payload kinds | ✅ agentTurn / systemEvent; deliver optional | Document deliver connectorId/chatId |
| Heartbeat | ✅ Heartbeat job, configurable | Keep; no OpenClaw protocol alignment |
| Nodes | ✅ sandbox-node, browser-node, node.invoke | More node types (scripts, APIs); connectors as nodes |

**Design:** Cron **storage** in agent dir (e.g. .first_paramecium/cron); **execution** in Agent process or daemon; **report** via deliver + connector.message.push.

### Definition (agent folder)

| Area | Status | Plan |
|------|--------|------|
| Soul / identity | ✅ SOUL.md, IDENTITY.md | Optional: multi-identity |
| Skills | ✅ skills/&lt;name&gt;/ SKILL.md, scripts | Self-evolution (skill-creator) |
| Memory / knowledge | ✅ memory/, KNOWLEDGE.md, knowledge/ | Extend retrieval and persistence as needed |
| Cron definition | ✅ cron/jobs.json, @monou/cron | deliver supported |

**Design:** The Definition (agent folder) is fully defined by ParameciumU; any runtime that follows the dir convention can load the same agent. Same Definition can run on your machine or on an **AI OS** device; see [ai-os-sketch](./ai-os-sketch.md).

## Protocol and implementation

- **Protocol:** Methods and payloads in packages/gateway are defined by ParameciumU; changes for simplicity and multi-client support.
- **Server:** apps/gateway is the reference server.
- **Clients:** Control UI, TUI, feishu-node, apps/agent use @monou/gateway; no OpenClaw client dependency.

## Roadmap (suggested order)

1. **Docs and conventions** — README, architecture, gateway, apps state “independent protocol, no OpenClaw dependency”; capability comparison is planning reference only.
2. **Cron deliver UX** — Document deliver connectorId/chatId; optional UI to pick “report to” connector/session.
3. **Connector extension** — New connectors (WeCom, DingTalk, HTTP API) as nodes or connector clients; doc: env vars, startup, mapping.
4. **Optional** — Agent groups and routing; method-level auth and audit; session labels, archive, export; remote agent / multi-machine.

## Summary

- ParameciumU **covers and exceeds** comparable capabilities; **does not depend on or align with** OpenClaw.
- Capability planning uses “connection layer, control plane, execution, definition” and OpenClaw as **reference** to avoid gaps.
- Protocol and implementation serve ParameciumU only; docs say “capability coverage and beyond,” not “OpenClaw compatible.”

## Next steps

- [Architecture](./architecture.md)
- [Gateway protocol](../gateway/protocol.md)
- [Apps](../runtime/apps.md)
- [Getting started](../start/getting-started.md)
