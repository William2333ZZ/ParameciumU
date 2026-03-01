---
title: "Paramecium vision"
summary: "The paramecium metaphor: absorb, evolve, reproduce. First paramecium, skills, and future shape."
read_when:
  - Understanding product naming and worldview
  - Planning self-evolution and multi-agent features
---

# ParameciumU: you are a paramecium

## Metaphor: absorb and evolve

ParameciumU starts from **the first paramecium**: single-celled, absorbent, evolvable, reproducible. In practice we **absorb** ideas from the ecosystem and evolve on an independent stack:

- **Gateway, sessions, cron, connectors** — ParameciumU has its own protocol and implementation; we cover and exceed comparable capabilities without depending on any single upstream.
- **Skills, knowledge, memory** — The agent absorbs knowledge and turns it into capability (skill-creator, knowledge, memory, agent-creator, node-creator).
- **Control UI, TUI, Feishu** — Clients and connector-style nodes; connector-layer software can be implemented as **nodes** (see [architecture](./architecture.md)).

**.first_paramecium** is “the first paramecium”: the default agent dir in your workspace, same shape as `packages/agent-template/template`. Its **skills** are aligned with the template (ensureAgentDir() fills missing ones): base_skill, skill-creator, agent-creator, node-creator, memory, knowledge, cron, web_skill, gateway_skill, etc. From this one, you absorb, evolve, and clone more agents.

## Why the metaphor holds

- **Absorb** = Ingest knowledge (knowledge/), skills (skills/), memory (MEMORY.md). What you feed it becomes capability.
- **Evolve** = More skills, richer knowledge, behavior that fits you; SOUL.md and IDENTITY.md can be updated as it learns.
- **Reproduce** = Clone the same definition into a new dir (new agentId) or create child agents (agent-creator). One paramecium becomes many.

So **“You are a Paramecium”** + **absorb, evolve, reproduce** is consistent. **ParameciumU** = Paramecium + U → your paramecium, or you as a paramecium — a single-cell start that keeps evolving.

## Naming

| Concept | Name | Meaning |
|---------|------|---------|
| Product | **ParameciumU** | Sovereign agent platform with the paramecium metaphor |
| Default agent dir | **.first_paramecium** | The first paramecium in your workspace; can be cloned or evolved |
| Other agents | Same-structure dirs | e.g. agents/code_engineer; same “species”, different instance |

## Future

1. **First paramecium** — One default, configurable agent in .first_paramecium; SOUL/IDENTITY/skills/knowledge/memory keep absorbing and evolving.
2. **Absorb and evolve** — Knowledge, memory, skills = nutrients; conversation and tools = digestion. skill-creator, knowledge_learn, memory, heartbeat/cron already support this.
3. **Reproduce and specialize** — Clone from .first_paramecium (new agentId) or use agent-creator to spawn child agents; future: explicit “paramecium clone”, multi-dir management.
4. **Same definition, many runtimes** — The same Definition (agent folder) can run on your machine or on an **AI OS** device; see [ai-os-sketch](./ai-os-sketch.md).

## Next steps

- [Vision and roadmap](./vision-and-roadmap.md)
- [Architecture](./architecture.md)
- [Agent directory](./agent-directory.md)
