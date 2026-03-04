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
├── llm.json          # Optional; OpenAI-compatible LLM config (apiKey, baseURL, model)
└── (other skills or config)
```

- **SOUL.md** — Principles, boundaries, evolution; injected every turn. See [SOUL](../../.first_paramecium/SOUL.md).
- **IDENTITY.md** — Who the agent is; can evolve over time.
- **skills/** — One subdir per skill: SKILL.md, scripts/, references/. Use **agent-creator** to create new agents, **skill-creator** to create new skills, **node-creator** to start or design nodes.
- **memory/**, **MEMORY.md** — Long-term memory (memory skill).
- **KNOWLEDGE.md**, **knowledge/** — Knowledge base (knowledge skill): search, learn, topic/point layout.
- **cron/jobs.json** — Scheduled jobs; CronStore read/write; Gateway exposes cron.* RPC. Jobs can have **deliver** (e.g. push to Feishu after run).
- **llm.json** — Optional. OpenAI-compatible LLM config: `apiKey`, `baseURL`, `model`. Used by @monou/agent-from-dir when building context (`createAgentContextFromU`). Missing fields fall back to env `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`. Copy from `llm.json.example` and fill in.

**Cron deliver** — For `payload.kind === "agentTurn"` you can set `deliver: { connectorId, chatId }`. After the run, the Agent process pushes the reply to that connector/session (e.g. Feishu). Get chatId from session metadata or feishu-node / Control UI.

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

- **getAgentDir(rootDir)** — 返回 `path.join(rootDir, ".first_paramecium")`，仅用于未显式传 agentDir 时的辅助；**运行时无默认目录**，启动 agent 必须设 **AGENT_DIR**。
- **ensureAgentDir(options)** — 若目录不存在则从模板复制；可选 rootDir、agentDir、forceSync。
- **getAgentSkillDirs(rootOrAgentDir, opts)** — 返回该 agent 目录下技能路径列表。

启动方式：`GATEWAY_URL=... AGENT_ID=... AGENT_DIR=... npm run agent`，无默认值；常用示例为 `AGENT_ID=.first_paramecium AGENT_DIR=./.first_paramecium`。多 agent 时每个进程设不同 AGENT_ID/AGENT_DIR，每目录可有自己的 **llm.json**。新建 agent 用 **agent-creator** 技能（create-and-connect.sh 或分步）。

## Runtime relationship

- **Loading** — apps/agent、TUI、Gateway 通过 @monou/agent-from-dir 的 `buildSessionFromU`（需传入 agent 目录）、`createAgentContextFromU` 加载；该目录的 **llm.json** 控制模型，SOUL.md/IDENTITY.md 定义身份并注入 system prompt。
- **Evolution** — Edit SOUL/IDENTITY or skills in place; next load picks up changes. No release needed.
- **Portability** — Any folder that follows this convention is a ParameciumU-compatible agent; version it (git), copy, move.

## Multiple agents

One Gateway can have many agent processes; each uses a different **AGENT_ID** and **AGENT_DIR**. In Control UI or RPC you choose agentId/session; cron and sessions are keyed by agent/device and sessionKey.

## Next steps

- [Agent running](../runtime/agent-running.md) — How session and context are built, runTurn, heartbeat.
- [Architecture](./architecture.md) — Layer model, Gateway, nodes.
- [Gateway protocol](../gateway/protocol.md) — Connect, RPC, sessions, node.invoke.
- [Getting started](../start/getting-started.md) — Run the organism.
