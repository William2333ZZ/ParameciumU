# Agent Directory

An agent in ParameciumU is a **directory** with a fixed layout. The runtime (`@monou/agent-from-dir`) loads identity, soul, memory, knowledge, and skills from this directory. This page is derived from `packages/agent-template` and `packages/agent-from-dir`.

## Default path and ID

- **Default directory name**: `.first_paramecium` (exported as `DEFAULT_AGENT_DIR` in `@monou/agent-template`).
- **Default base agent ID**: `U_base` (`U_BASE_AGENT_ID`). When starting the Agent app you set `AGENT_ID` and `AGENT_DIR` explicitly; there is no default agent dir at runtime.

## Ensuring an agent directory

- **getAgentDir(rootDir)**  
  Returns `path.join(path.resolve(rootDir), ".first_paramecium")`.

- **ensureAgentDir(options)**  
  - `options.rootDir`: workspace root (default `process.cwd()`).  
  - `options.agentDir`: direct path to the agent dir (overrides rootDir).  
  - `options.forceSync`: if true, overwrite existing dir with template; otherwise only add missing files from the template.  
  If the directory does not exist, it is created by copying the package template from `@monou/agent-template/template`. Returns the resolved agent directory path.

## Root-level files

| File | Purpose |
|------|--------|
| `IDENTITY.md` | Who the agent is. Injected into the system prompt as “your IDENTITY”. |
| `SOUL.md` | Principles and boundaries. Injected as “your SOUL”. |
| `MEMORY.md` | Long-term memory: **## Store** (append-only), **## Forgotten** (marked for forget). Used by the memory skill. |
| `KNOWLEDGE.md` | Optional; **## Add** is the default append target for knowledge_add / knowledge_learn when no topic is given. |
| `cron/jobs.json` | Cron job store (see [Cron](./cron.md)). |

Additional paths used by skills (see skill docs in template):

- `memory/YYYY-MM-DD.md` — daily logs.  
- `knowledge/` — topic-based knowledge (e.g. `knowledge/<topic>/<point>.md`).  
- `memory/index.sqlite`, `knowledge/index.sqlite` — optional FTS5 (and optional vector) indexes.

## Skills directory

- **Path**: `skills/` under the agent dir.
- **Discovery**: The runtime lists subdirectories of `skills/` that contain `SKILL.md` and treats them as skills. Base skills from the template are also resolved via `getAgentSkillDirs(agentDir, { asAgentDir: true })`, which returns paths for each name in `U_BASE_SKILL_NAMES`.

**Base skill names** (`U_BASE_SKILL_NAMES`):  
`base_skill`, `code_skill`, `todo_skill`, `skill-creator`, `agent-creator`, `memory`, `knowledge`, `cron`, `web_skill`, `browser_skill`, `message_skill`, `sessions_skill`, `gateway_skill`.

Each skill can have:

- **SKILL.md** — description and instructions for the model.  
- **scripts/tools.ts** (or **tools.js**) — defines tools and an `executeTool`-style handler. The runtime loads these and merges tools; execution is routed by tool name (memory_*, knowledge_*, cron_*, code_*, todo_*, web_*, browser_*, message_*, sessions_*, gateway_*, and script-based tools from other skills).

Topic knowledge: a directory named `<topic>_knowledge` under `skills/` (with `SKILL.md` and optional `topic.json`) registers a tool `<topic>_knowledge_search` that searches only that topic’s knowledge. Created via the knowledge skill’s `knowledge_skill_create`.

## How the session is built

1. **Agent dir** is resolved via `ensureAgentDir` (or direct path when `skipEnsureAgentDir` and `agentDir` are set).
2. **Skill dirs** = base skill dirs (from `U_BASE_SKILL_NAMES`) + discovered dirs under `skills/` that have `SKILL.md`.
3. **Tools** are loaded from each skill’s `scripts/tools.ts` (or `.js`); memory, knowledge, cron, web, browser, message, sessions, gateway, code, todo, and script tools are merged and executed by name.
4. **System prompt** includes SOUL and IDENTITY: contents of `SOUL.md` and `IDENTITY.md` from the agent dir are read and injected by `readSoulAndIdentity(agentDir)` in `build-session.ts`.

LLM config is taken from environment (e.g. `BIANXIE_*`, `AIHUBMIX_*`, `OPENAI_*`). The stream function and agent loop config are created in `createAgentContextFromU`; the actual turn is run with `runAgentTurnWithTools` from `@monou/agent-sdk`.

## Workspace and cron store

- The **workspace root** (e.g. `process.cwd()` when starting the Gateway) is used for the default cron store path when the agent id is the default local agent (e.g. `.first_paramecium/cron/jobs.json` under that root).
- The **Agent process** uses `AGENT_DIR` to find `cron/jobs.json` for that agent and runs the scheduler that executes due jobs (e.g. Heartbeat).

For full tool lists and file layouts, see the skill `SKILL.md` files under `packages/agent-template/template/skills/`.
