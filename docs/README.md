---
title: ParameciumU
summary: "Sovereign agent platform: definition = folder; Hub routes, edge runs. Connector-layer as nodes."
read_when:
  - Introducing ParameciumU to someone new
---

# ParameciumU

**ParameciumU** — A sovereign agent platform where “you are a paramecium”: absorb, evolve, reproduce. Definition is a **folder** (SOUL, IDENTITY, skills, memory, knowledge, cron); the same definition can run on your machine or on an AI OS device. Default agent dir: **.first_paramecium** (the first paramecium).

## Doc structure

- **Getting started** — How to run: [Getting started](start/getting-started.md) (build, Gateway, Agent, Control UI, TUI, nodes).
- **Concepts and design** — [Architecture](concepts/architecture.md) (Hub, Agent, Node, Definition, Client; connectors as nodes), [Agent directory](concepts/agent-directory.md), [Vision and roadmap](concepts/vision-and-roadmap.md), [Paramecium vision](concepts/paramecium-vision.md), [AI OS sketch](concepts/ai-os-sketch.md).
- **Gateway** — [Protocol](gateway/protocol.md) (connect, RPC, sessions, node.invoke), [Overview](gateway/index.md), [Multi-agent](gateway/multi-agent.md).
- **Automation** — [Cron](automation/cron.md), [Heartbeat](automation/heartbeat.md).
- **Runtime** — [Apps](runtime/apps.md) (gateway, agent, control-ui, TUI, feishu-node, sandbox-node, browser-node), [Packages](runtime/packages.md), [Agent running](runtime/agent-running.md), [Heartbeat](runtime/heartbeat.md).
- **Control UI** — [Design](control-ui/design.md), [Node capabilities](control-ui/node-capabilities.md).
- **Reference** — [Code skill design](reference/code-skill-design.md), [Browser node design](reference/browser-node-design.md).
- **Maintenance** — [Deploy docs site](deploy-docs-site.md).

## How it fits together

```
         Definition (agent folder) — SOUL · IDENTITY · skills/ · memory/ · cron/
                                    │ loaded by
    ┌───────────────────────────────┼───────────────────────────────┐
    │                          Hub (Gateway)                          │
    │           route · sessions · cron RPC · node.invoke             │
    └───┬─────────────────────────────┬─────────────────────────┬───┘
        │                             │                         │
   Agent (runner)                Node (browser,             Client (Control UI,
   + definition                 sandbox, connector)         TUI, Feishu via node)
```

- **Skills** — agent-creator (new agents), node-creator (start/create nodes), gateway_skill (topology, node.invoke, sessions, push), cron, memory, knowledge, etc. See `.first_paramecium/skills/`.
- **Creating agents** — Use agent-creator skill (scripts under agent-creator/scripts/).
- **Creating or starting nodes** — Use node-creator (browser-node, sandbox-node, or custom node).

## Quick links

| Topic | Doc |
|-------|-----|
| Run locally | [Getting started](start/getting-started.md) |
| Roles (Hub, Agent, Node) | [Architecture](concepts/architecture.md) |
| Agent folder | [Agent directory](concepts/agent-directory.md) |
| Gateway API | [Protocol](gateway/protocol.md) |
| Apps and env | [Apps](runtime/apps.md) |
| Cron and Heartbeat | [Cron](automation/cron.md), [Heartbeat](automation/heartbeat.md) |
