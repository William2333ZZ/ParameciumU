---
name: memory
description: "Long-term memory (vacuole): search, read, store, forget, sync. Use when (1) user asks about past decisions, preferences, people, todos, or dates — call memory_search or memory_recall then memory_get; (2) user says 'remember this' — memory_store(text, target?); (3) mark something to forget — memory_forget(text); (4) after bulk edits to MEMORY.md or memory/* — memory_sync. Workspace: MEMORY.md and memory/YYYY-MM-DD.md under agent dir (default ./.u or MEMORY_WORKSPACE). base_skill does raw read/write; this skill adds search (FTS5, optional hybrid embedding), Store/Forgotten sections, and daily logs."
---

# Memory

The agent’s **long-term memory** lives in the workspace: `MEMORY.md` and `memory/YYYY-MM-DD.md`. **base_skill** can read/write any file; this skill adds **search** (FTS5, optional hybrid embedding), **memory_store** (## Store or daily log), **memory_forget** (## Forgotten), and **memory_sync** (rebuild index). What’s on disk is the source of truth for recall.

## When to use which tool

| Goal | Tool |
|------|------|
| Answer about past / preferences / who / when | **memory_search**(query, maxResults?) or **memory_recall**(…) then **memory_get**(path, from?, lines?) as needed |
| Persist “remember this” | **memory_store**(text, target?) — appends to MEMORY.md ## Store or today’s memory/YYYY-MM-DD.md |
| Mark for forgetting (review later) | **memory_forget**(text) — appends to MEMORY.md ## Forgotten; does not delete |
| Refresh search after bulk edits | **memory_sync** — rebuilds FTS5 index (Node 22+); optional embedding and session transcript |

## Workflow

1. **Recall**: `memory_search` or `memory_recall` → use `memory_get` to read full snippets.
2. **Store**: `memory_store(text)` (longterm) or `memory_store(text, "daily")` for today’s log.
3. **Forget**: `memory_forget(text)` to append to ## Forgotten for human review.
4. After many file changes and Node 22+: `memory_sync` to rebuild the index.

## Layout and env

Workspace root: default `./.u` or `MEMORY_WORKSPACE` (in monoU often the agent dir, e.g. `.first_paramecium`). Paths: `MEMORY.md` (## Store, ## Forgotten), `memory/YYYY-MM-DD.md`, optional `memory/index.sqlite`.  
Full layout and env: [references/layout.md](references/layout.md).

## Short-term vs long-term

- **Same-session multi-turn**: Handled by runtime `state.messages`; no tools needed.
- **Across sessions**: Use **memory_store** or **write** to persist; then **memory_search** to recall.

See [references/short-term-memory.md](references/short-term-memory.md).

## Pre-compaction flush

Before context compaction, you can run a silent turn so the model writes lasting notes to disk. From `@monou/agent-from-dir`: `runMemoryFlushTurn(session, state, config, streamFn, { prompt?: string })`. Default prompt: "Session nearing compaction. Write any lasting notes to MEMORY.md or memory/YYYY-MM-DD.md now. Reply with NO_REPLY if nothing to store."

## Memory vs knowledge

- **memory**: What happened, decisions, preferences, people, todos, dates. Use for “what did we decide / my preference.”
- **knowledge**: Reference material, docs, FAQ (KNOWLEDGE.md, knowledge/*). Use for “according to the docs.”
