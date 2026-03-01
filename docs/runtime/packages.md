---
title: "Packages"
summary: "packages/ modules: roles, dependencies, exports, and usage. Aligns with architecture (Hub, Agent, Node, Definition)."
read_when:
  - Developing or extending agent-core, gateway, skills
  - Understanding build order and dependencies
---

# Packages

This doc describes the modules under `packages/` in dependency order: role, exports, and usage. Build order is in the root `package.json` `build` script. See [architecture.md](../concepts/architecture.md) for Hub, Agent, Node, Definition.

## 1. @monou/shared

**Role:** Shared types and utilities for the repo.

**Dependencies:** None.

**Main exports:**

- `createId`, ID helpers
- `MessageRole`, `TextContent`, and related types

**Usage:**

```ts
import { createId, type MessageRole, type TextContent } from "@monou/shared";
```

---

## 2. @monou/agent-core

**Role:** Agent runtime core: state, message types, single-turn loop. No LLM or Gateway dependency.

**Dependencies:** @monou/shared.

**Main exports:**

- `AgentState`,`AgentMessage`、`AgentTool`、`StreamFn`
- `createInitialState`、`appendUserMessage`、`runOneTurn`
- `AgentLoopConfig`（convertToLlm、tools、maxToolRounds）

**Usage:** Implement `StreamFn` (e.g. with @monou/llm-provider `createStreamFn`); call `runOneTurn` in a loop and run tools between turns.

```ts
import {
  createInitialState,
  appendUserMessage,
  runOneTurn,
  type AgentLoopConfig,
  type StreamFn,
} from "@monou/agent-core";
```

---

## 3. @monou/skills

**Role:** Load SKILL.md from dirs and format as system prompt fragments (Agent Skills convention). Depends only on filesystem and dir layout.

**Dependencies:** None.

**Main exports:**

- `loadSkills(options?)` — 从多处合并加载技能，去重、碰撞诊断
- `loadSkillsFromDir(options)` — 从单个目录加载（目录内根目录直接 `.md` 或子目录下 `SKILL.md`；忽略 `node_modules`、以点开头的文件/目录）
- `formatSkillsForPrompt(skills)` — 将加载结果格式化为可拼进 system prompt 的片段

**技能目录结构**：每个技能为一目录，内含 `SKILL.md`；可选 YAML frontmatter（name、description、disable-model-invocation 等）。

**loadSkills 的 options（均为可选）**：

| Option | Description |
|--------|-------------|
| `cwd` | Working dir for relative paths; default `process.cwd()`. |
| `agentDir` | Agent root (e.g. `.first_paramecium`). Caller should pass explicitly. |
| `skillPaths` | Extra skill paths (files or dirs); relative to `cwd`. |
| `includeDefaults` | Load default locations; default `true`. From `agentDir/skills`; if `cwd` set, also from cwd config dir `skills` (legacy). |

**Typical use:** agent-from-dir and agent-sdk pass `agentDir` (e.g. `.first_paramecium`); load from `agentDir/skills`; use `skillPaths` for extra skill dirs.

```ts
import { loadSkills, loadSkillsFromDir, formatSkillsForPrompt } from "@monou/skills";
import path from "node:path";

// ParameciumU：从 .first_paramecium/skills 加载
const result = loadSkills({ agentDir: path.join(process.cwd(), ".first_paramecium") });
const promptFragment = formatSkillsForPrompt(result.skills);

// 或仅从单个目录加载
const fromDir = loadSkillsFromDir({ dir: path.join(process.cwd(), ".first_paramecium", "skills"), source: "user" });
```

---

## 4. @monou/cron

**Role:** Cron job storage and schedule computation; optional long-running scheduler.

**Dependencies:** None (uses croner).

**Main exports:**

- `CronStore(storePath)`:`list`、`status`、`add`、`update`、`remove`、`run`
- 调度类型：`at`（一次性 ISO 时间）、`every`（间隔 ms）、`cron`（cron 表达式 + 可选时区）
- `runScheduler(storePath, options?)`：常驻循环，到点可调用 `onJobDue(job)` 执行自定义逻辑（如跑 agent）

**Storage:** JSON file; default `./.first_paramecium/cron/jobs.json`; override with `CRON_STORE`.

**Usage:**

```ts
import { CronStore, getDefaultStorePath } from "@monou/cron";
import { runScheduler } from "@monou/cron/scheduler";
const store = new CronStore(getDefaultStorePath(process.cwd()));
const jobs = await store.list({ includeDisabled: true });
// 常驻：runScheduler(storePath, { onJobDue: async (job) => { ... } });
```

**CLI:** `npx monou-cron` or root `npm run cron:daemon` starts a **standalone** scheduler (only advances timestamps; does not run agent turn). Usually not needed: **apps/agent** embeds runScheduler + onJobDue and runs turns on schedule.

---

## 5. @monou/llm-provider

**Role:** Unified LLM API: multi-provider registry, stream/complete, and `createStreamFn` for agent-core.

**Dependencies:** None (uses openai etc.).

**Main exports:**

- `registerBuiltins()`,`getModel(provider, modelId)`
- `stream(model, options, opts)`、`complete(model, options, opts)`
- `createStreamFn(model, opts)`：供 `createAgent` / `runAgentTurn` 作为 streamFn

**Env:** Uses `OPENAI_API_KEY` when apiKey not passed.

**Usage:**

```ts
import { getModel, createStreamFn, registerBuiltins } from "@monou/llm-provider";
registerBuiltins();
const model = getModel("openai", "gpt-4o");
const streamFn = createStreamFn(model, { apiKey: process.env.OPENAI_API_KEY });
```

---

## 6. @monou/agent-sdk

**Role:** High-level Agent SDK: createAgent, runTurn, skills and pluggable LLM.

**Dependencies:** @monou/agent-core, @monou/shared, @monou/skills.

**Main exports:**

- `createAgent(options)`:返回 `{ state, config, streamFn }`；可选 `systemPrompt`、`skillDirs`、`tools`、`streamFn`
- `runAgentTurn`、`runAgentTurnWithTools`、`runAgentTurnWithToolsStreaming`
- `loadToolsFromSkillDir`, `loadToolsFromSkillDirs` (load scripts/tools.js from skill dirs)

**Usage:**

```ts
import { createAgent, runAgentTurnWithTools } from "@monou/agent-sdk";
import { getModel, createStreamFn, registerBuiltins } from "@monou/llm-provider";
registerBuiltins();
const model = getModel("openai", "gpt-4o");
const streamFn = createStreamFn(model, { apiKey: process.env.OPENAI_API_KEY });
const { state, config, streamFn: fallback } = createAgent({ tools: [], streamFn });
const result = await runAgentTurnWithTools(state, config, streamFn ?? fallback, "Hello", executeTool);
```

---

## 7. @monou/agent-template

**Role:** Agent dir template and path convention. Template + ensureAgentDir / getAgentDir only; no run logic.

**Dependencies:** None.

**Main exports:**

- `U_BASE_AGENT_ID`,`U_BASE_SKILL_NAMES`
- `getAgentDir(rootDir?)`：默认 `./.first_paramecium`
- `ensureAgentDir(options?)`：若目录不存在则从包内 template 复制；可选 `rootDir`、`agentDir`、`forceSync`
- `getAgentSkillDirs(rootOrAgentDir?, opts?)`：返回必备技能目录绝对路径

**Usage:** Used by @monou/agent-from-dir and apps to locate or init .first_paramecium-style dirs.

---

## 8. @monou/agent-from-dir

**Role:** Load from agent dir (.first_paramecium or any same-structure dir) and build session/context; run logic lives in apps (gateway, TUI, scripts).

**Dependencies:** @monou/agent-template, @monou/agent-sdk, @monou/agent-core, @monou/llm-provider.

**Main exports:**

- Re-exports from agent-template:`ensureAgentDir`、`getAgentDir`、`getAgentSkillDirs`、`U_BASE_AGENT_ID`、`U_BASE_SKILL_NAMES`
- `buildSessionFromU(rootDir, options)`：构建 `AgentSession`（skills、SOUL、IDENTITY、cron 路径、gatewayInvoke 等）
- `createAgentContextFromU(session)`：返回 `{ state, config, streamFn }` 及工具执行上下文
- `runMemoryFlushTurn`、`MEMORY_FLUSH_DEFAULT_PROMPT`
- `loadSkillScriptTools`、`createSkillScriptExecutor`；类型 `AgentSession`、`GatewayInvoke`、`ScriptToolEntry`

**Usage:** apps/agent, TUI, Gateway read-only (e.g. skills.status) load via this package from .first_paramecium or a given dir.

```ts
import { buildSessionFromU, createAgentContextFromU } from "@monou/agent-from-dir";
const session = await buildSessionFromU(rootDir, { agentDir, gatewayInvoke });
const { state, config, streamFn } = createAgentContextFromU(session);
```

---

## 9. @monou/tui

**Role:** Terminal UI components and diff rendering for TUI app (apps/u-tui).

**Dependencies:** get-east-asian-width, marked, etc.

**Main exports:** TUI, ProcessTerminal, Component, etc., for apps/u-tui.

---

## 10. @monou/gateway

**Role:** Gateway protocol types and client (callGateway) for CLI/TUI/Control UI to call ParameciumU Gateway. Independent of who runs the server.

**Dependencies:** None (uses ws).

**Main exports:**

- Types:`GatewayRequest`、`GatewayResponse`、`GatewayEvent`、`ErrorShape`、`ConnectIdentity`、`GatewayMethod`、`GatewayEventName`
- 常量：`GATEWAY_METHODS`、`GATEWAY_EVENTS`
- `callGateway(options)` — one-off WebSocket RPC (connect → send request → receive response → close); CallGatewayOptions: url, method, params, timeoutMs, etc.

**Usage:**

```ts
import { callGateway } from "@monou/gateway";
const jobs = await callGateway&lt;{ jobs: unknown[] }&gt;({
  url: "ws://127.0.0.1:9347",
  method: "cron.list",
  params: { includeDisabled: true },
});
```

---

## Build order (root build script)

shared → agent-core → skills → cron → agent-sdk → agent-template → llm-provider → agent-from-dir → tui → gateway; then apps: TUI (u-tui), agent, sandbox-node, gateway.

## Next steps

- [Architecture](../concepts/architecture.md)
- [Agent directory](../concepts/agent-directory.md)
- [Apps](./apps.md)
- [Code skill design](../reference/code-skill-design.md)
