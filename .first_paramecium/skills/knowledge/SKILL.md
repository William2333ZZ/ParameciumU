---
name: knowledge
description: "Structured knowledge (vacuole): search, learn, and evolve. Use when (1) answering from docs/FAQ/knowledge-base — call knowledge_search (optional topic) then knowledge_get; (2) user says 'learn this' or 'remember this' — knowledge_learn(text, topic?, point?) or knowledge_add; (3) 'learn from the web' — web_search then knowledge_learn_from_urls; (4) list topics or points — knowledge_list_topics, knowledge_list_points(topic); (5) turn a topic into a dedicated skill — knowledge_skill_create(topic); (6) after bulk edits to KNOWLEDGE.md or knowledge/* — knowledge_sync. Workspace is KNOWLEDGE.md and knowledge/*.md under agent dir; base_skill does raw read/write; this skill adds search, topic/point layout, and FTS5 index."
---

# Knowledge

The agent’s **structured knowledge** lives in the workspace: `KNOWLEDGE.md` and `knowledge/*.md`. **base_skill** can read/write any file; this skill adds **search** (FTS5, optional hybrid embedding), **topic/point layout**, **learn** (from text or URLs), and **skill creation** from a topic so the paramecium can keep evolving.

## When to use which tool

| Goal | Tool |
|------|------|
| Answer from docs/FAQ/knowledge | **knowledge_search**(query, topic?, maxResults?) then **knowledge_get**(path, from?, lines?) as needed |
| Add one-off fact | **knowledge_add**(text, path?) — appends to KNOWLEDGE.md ## Add or given path |
| Learn from text (topic/point) | **knowledge_learn**(text, topic?, point?, source?) — writes to knowledge/<topic>/<point>.md or learned.md |
| Learn from the web | **web_search** for URLs, then **knowledge_learn_from_urls**(urls, topic?, point?) |
| See what’s in the vacuole | **knowledge_list_topics**; **knowledge_list_points**(topic) |
| Turn a topic into a skill | **knowledge_skill_create**(topic, description?) — creates `<topic>_knowledge` skill with `<topic>_knowledge_search` |
| Refresh search after bulk edits | **knowledge_sync** — rebuilds FTS5 index (Node 22+); optional embedding if configured |

## Workflow

1. **Answer from knowledge**: `knowledge_search` (optionally restrict by topic) → use `knowledge_get` to read full snippets.
2. **User says “learn this”**: `knowledge_learn(text, topic?, point?)`; for “learn from the web”, `web_search` then `knowledge_learn_from_urls`.
3. **Single fact**: `knowledge_add(text)` or `knowledge_add(text, path)`.
4. **Evolve a topic into a skill**: `knowledge_list_topics` to see topics; `knowledge_skill_create(topic)` so the next run has `<topic>_knowledge_search` for that topic only.
5. After many file changes and Node 22+: `knowledge_sync` to rebuild the index.

## Layout and env

Workspace root is the agent dir (default `./.first_paramecium`) or `KNOWLEDGE_WORKSPACE`. Paths: `KNOWLEDGE.md` (optional; ## Add for appends), `knowledge/<topic>.md`, `knowledge/<topic>/<point>.md`, optional `knowledge/index.sqlite` (FTS5 + optional embeddings).  
Full layout and env vars: [references/layout.md](references/layout.md).

## Knowledge vs memory

- **memory**: What happened, decisions, preferences, people, todos, dates (MEMORY.md, memory/YYYY-MM-DD.md). Use for “what did we decide / who said what.”
- **knowledge**: Reference material, docs, FAQ, how-to, concepts (KNOWLEDGE.md, knowledge/*). Use for “according to the docs / knowledge base.”
