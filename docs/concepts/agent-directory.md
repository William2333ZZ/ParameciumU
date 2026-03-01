---
title: "Agent directory (Definition)"
summary: "Definition = agent folder layout: SOUL/IDENTITY/skills/memory/knowledge/cron. Same shape as .first_paramecium."
read_when:
  - Creating or migrating an agent
  - Understanding how skills, memory, knowledge, and cron attach
---

# Agent directory (Definition)

Agents in ParameciumU are defined by a **folder that follows a fixed layout** — the **Definition**. As long as that folder exists, any compatible runtime can load, backup, or move the agent. This doc describes that layout. For how the Agent runner loads and executes it, see [agent-running.md](../runtime/agent-running.md).

## Directory structure

Any agent root (e.g. `.first_paramecium` or `agents/sidekick`) should look like:

```
&lt;agent_root&gt;/
├── SOUL.md           # Soul: principles, boundaries, vibe; injected into system prompt
├── IDENTITY.md       # Identity: name, type, public profile
├── HEARTBEAT.md      # Optional; read during heartbeat; empty content can skip that run
├── skills/           # Skill directories
│   ├── base_skill/
│   ├── memory/
│   ├── cron/
│   ├── skill-creator/
│   ├── agent-creator/
│   ├── node-creator/
│   ├── knowledge/
│   ├── gateway_skill/
│   ├── web_skill/
│   ├── todo_skill/
│   ├── code_skill/
│   └── ...           # Other skills, including &lt;topic&gt;_knowledge from knowledge_skill_create
├── memory/           # Optional; used by memory skill
├── MEMORY.md         # Optional
├── KNOWLEDGE.md      # Optional; knowledge skill
├── knowledge/        # Optional; topic-based knowledge (knowledge skill)
│   └── index.sqlite  # Optional FTS5 index (Node 22+, knowledge_sync)
├── cron/
│   └── jobs.json     # Cron jobs (cron skill / CronStore)
└── (other skills or config)
```

- **SOUL.md** — Principles, boundaries, evolution; injected every turn. See [SOUL](../../.first_paramecium/SOUL.md).
- **IDENTITY.md** — Who the agent is; can evolve over time.
- **skills/** — One subdir per skill: SKILL.md, scripts/, references/. Use **agent-creator** to create new agents, **skill-creator** to create new skills, **node-creator** to start or design nodes.
- **memory/**, **MEMORY.md** — Long-term memory (memory skill).
- **KNOWLEDGE.md**, **knowledge/** — Knowledge base (knowledge skill): search, learn, topic/point layout.
- **cron/jobs.json** — Scheduled jobs; CronStore read/write; Gateway exposes cron.* RPC. Jobs can have **deliver** (e.g. push to Feishu after run).

**Cron deliver** — For `payload.kind === "agentTurn"` you can set `deliver: { connectorId, chatId }`. After the run, the Agent process pushes the reply to that connector/session (e.g. Feishu). Get chatId from session metadata or feishu-app / Control UI.

**Sessions** — Not stored in the agent dir. Gateway holds them (e.g. `.gateway/sessions/sessions.json`, `transcripts/`). SessionKey is created by Gateway when not provided.

## Skills directory convention

Each skill is a subdir under `skills/` with at least:

- **SKILL.md** — Description and when to use; optional YAML frontmatter (name, description). Loaded by @monou/skills and formatted into the system prompt.
- **scripts/** — Optional; tools (e.g. tools.ts) loaded by agent-from-dir and exposed as agent tools.
- **references/** — Optional; reference docs.

The **agent-template** package defines the default set of skills (`U_BASE_SKILL_NAMES`). `ensureAgentDir()` copies missing skills from the template. Typical set: base_skill, code_skill, todo_skill, skill-creator, agent-creator, node-creator, memory, knowledge, cron, web_skill, gateway_skill. (Connector/session/message tools live in **gateway_skill**; browser/sandbox are invoked via **gateway_node_invoke** to Nodes.)

## Knowledge (knowledge skill)

Knowledge is for **reference material** (docs, FAQ, how-to). Memory is for **what happened** (decisions, preferences, people, dates).

| Path | Purpose |
|------|---------|
| KNOWLEDGE.md | Overview or single-file corpus; optional ## Add section for appends. |
| knowledge/*.md | Topic as single file (e.g. knowledge/faq.md). |
| knowledge/&lt;topic&gt;/ | Topic dir; underneath are point files (e.g. knowledge/stock/K-line.md). |
| knowledge/&lt;topic&gt;/learned.md | Default file when knowledge_learn is called with only topic. |
| knowledge/index.sqlite | Optional FTS5 index (Node 22+), created by knowledge_sync. |

Tools: knowledge_search, knowledge_get, knowledge_add, knowledge_learn, knowledge_learn_from_urls, knowledge_list_topics, knowledge_list_points, knowledge_sync, knowledge_skill_create. Workspace default is the agent root; override with KNOWLEDGE_WORKSPACE, etc.

## Template and paths (@monou/agent-template)

- **getAgentDir(rootDir)** — Default `path.join(rootDir, ".first_paramecium")`.
- **ensureAgentDir(options)** — If dir missing, copy from template; optional rootDir, agentDir, forceSync.
- **getAgentSkillDirs(rootOrAgentDir, opts)** — Returns list of skill dir paths.

Default agent dir is usually `.first_paramecium` in the repo; for multiple agents use `agents/&lt;id&gt;/` or any same-structure dir and set **AGENT_DIR**. Create new agents with the **agent-creator** skill (create-and-connect.sh or step-by-step).

## Runtime relationship

- **Loading** — apps/agent, TUI, Gateway (read-only e.g. skills.status) use @monou/agent-from-dir: `buildSessionFromU`, `createAgentContextFromU`.
- **Evolution** — Edit SOUL/IDENTITY or skills in place; next load picks up changes. No release needed.
- **Portability** — Any folder that follows this convention is a ParameciumU-compatible agent; version it (git), copy, move.

## Multiple agents

One Gateway can have many agent processes; each uses a different **AGENT_ID** and **AGENT_DIR**. In Control UI or RPC you choose agentId/session; cron and sessions are keyed by agent/device and sessionKey.

## Next steps

- [Agent running](../runtime/agent-running.md) — How session and context are built, runTurn, heartbeat.
- [Architecture](./architecture.md) — Layer model, Gateway, nodes.
- [Gateway protocol](../gateway/protocol.md) — Connect, RPC, sessions, node.invoke.
- [Getting started](../start/getting-started.md) — Run the organism.
