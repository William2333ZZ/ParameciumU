---
title: "模块说明 (packages)"
summary: "packages 下各模块的职责、依赖、导出与用法"
read_when:
  - 开发或扩展 agent-core、gateway、skills 时
  - 理解构建顺序与依赖时
---

# packages 模块说明

本文档按依赖顺序说明 `packages/` 下 10 个模块的职责、导出与用法。构建顺序见根目录 `package.json` 的 `build` 脚本。

## 1. @monou/shared

**职责**：共享类型与工具，供全仓库使用。

**依赖**：无。

**主要导出**：

- `createId`、ID 相关
- `MessageRole`、`TextContent` 等类型

**用法**：

```ts
import { createId, type MessageRole, type TextContent } from "@monou/shared";
```

---

## 2. @monou/agent-core

**职责**：Agent 运行时核心：状态、消息类型、单轮 loop 抽象。不依赖 LLM 或 Gateway。

**依赖**：@monou/shared。

**主要导出**：

- `AgentState`、`AgentMessage`、`AgentTool`、`StreamFn`
- `createInitialState`、`appendUserMessage`、`runOneTurn`
- `AgentLoopConfig`（convertToLlm、tools、maxToolRounds）

**用法**：实现 `StreamFn`（如用 @monou/llm-provider 的 `createStreamFn`），在循环中调用 `runOneTurn`，在轮次间执行工具并追加结果。

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

**职责**：从目录加载 SKILL.md，格式化为 system prompt 片段（Agent Skills 约定）。仅依赖文件系统与约定目录结构，无 ParameciumU 以外运行时依赖。

**依赖**：无。

**主要导出**：

- `loadSkills(options?)` — 从多处合并加载技能，去重、碰撞诊断
- `loadSkillsFromDir(options)` — 从单个目录加载（目录内根目录直接 `.md` 或子目录下 `SKILL.md`；忽略 `node_modules`、以点开头的文件/目录）
- `formatSkillsForPrompt(skills)` — 将加载结果格式化为可拼进 system prompt 的片段

**技能目录结构**：每个技能为一目录，内含 `SKILL.md`；可选 YAML frontmatter（name、description、disable-model-invocation 等）。

**loadSkills 的 options（均为可选）**：

| 选项 | 说明 |
|------|------|
| `cwd` | 当前工作目录，用于解析相对路径；默认 `process.cwd()`。 |
| `agentDir` | Agent 根目录（ParameciumU 中即 `.first_paramecium` 或与之间构的目录）。未传时使用包内默认解析（建议调用方显式传入）。 |
| `skillPaths` | 额外技能路径列表（文件或目录），相对路径按 `cwd` 解析。 |
| `includeDefaults` | 是否加载「默认」位置；默认 `true`。为 true 时从 `agentDir/skills` 加载；若传了 `cwd`，还会从 cwd 下某约定配置目录的 `skills` 子目录加载（兼容旧约定，ParameciumU 典型用法只需传 `agentDir`）。 |

**ParameciumU 典型用法**：由 agent-from-dir、agent-sdk 等调用时传入 `agentDir`（如 `.first_paramecium`），主要加载 `agentDir/skills`；需要额外技能目录时用 `skillPaths`。

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

**职责**：定时任务存储与调度计算；常驻调度器可选。无 OpenClaw 依赖。

**依赖**：无（使用 croner）。

**主要导出**：

- `CronStore(storePath)`：`list`、`status`、`add`、`update`、`remove`、`run`
- 调度类型：`at`（一次性 ISO 时间）、`every`（间隔 ms）、`cron`（cron 表达式 + 可选时区）
- `runScheduler(storePath, options?)`：常驻循环，到点可调用 `onJobDue(job)` 执行自定义逻辑（如跑 agent）

**存储**：JSON 文件，默认 `./.first_paramecium/cron/jobs.json`，可通过 `CRON_STORE` 覆盖。

**用法**：

```ts
import { CronStore, getDefaultStorePath } from "@monou/cron";
import { runScheduler } from "@monou/cron/scheduler";
const store = new CronStore(getDefaultStorePath(process.cwd()));
const jobs = await store.list({ includeDisabled: true });
// 常驻：runScheduler(storePath, { onJobDue: async (job) => { ... } });
```

**CLI**：`npx monou-cron` 或根目录 `npm run cron:daemon` 可启动**独立**常驻调度器（仅推进任务时间戳，不执行 agent turn）。通常不需要单独运行：**apps/agent** 进程内已内嵌 runScheduler + onJobDue，到点执行 runTurn。

---

## 5. @monou/llm-provider

**职责**：统一 LLM API：多 provider 注册、stream/complete、以及供 agent-core 使用的 `createStreamFn`。

**依赖**：无（使用 openai 等）。

**主要导出**：

- `registerBuiltins()`、`getModel(provider, modelId)`
- `stream(model, options, opts)`、`complete(model, options, opts)`
- `createStreamFn(model, opts)`：供 `createAgent` / `runAgentTurn` 作为 streamFn

**环境**：未传 `apiKey` 时使用 `OPENAI_API_KEY`。

**用法**：

```ts
import { getModel, createStreamFn, registerBuiltins } from "@monou/llm-provider";
registerBuiltins();
const model = getModel("openai", "gpt-4o");
const streamFn = createStreamFn(model, { apiKey: process.env.OPENAI_API_KEY });
```

---

## 6. @monou/agent-sdk

**职责**：高层 Agent SDK：createAgent、runTurn，接入 skills 与可插拔 LLM。

**依赖**：@monou/agent-core、@monou/shared、@monou/skills。

**主要导出**：

- `createAgent(options)`：返回 `{ state, config, streamFn }`；可选 `systemPrompt`、`skillDirs`、`tools`、`streamFn`
- `runAgentTurn`、`runAgentTurnWithTools`、`runAgentTurnWithToolsStreaming`
- `loadToolsFromSkillDir`、`loadToolsFromSkillDirs`（从 skill 目录加载 scripts/tools.js 等，见各 skill 目录下 tools）

**用法**：

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

**职责**：Agent 目录模板与路径约定。仅负责模板与 ensureAgentDir / getAgentDir，不包含运行逻辑。

**依赖**：无。

**主要导出**：

- `U_BASE_AGENT_ID`、`U_BASE_SKILL_NAMES`
- `getAgentDir(rootDir?)`：默认 `./.first_paramecium`
- `ensureAgentDir(options?)`：若目录不存在则从包内 template 复制；可选 `rootDir`、`agentDir`、`forceSync`
- `getAgentSkillDirs(rootOrAgentDir?, opts?)`：返回必备技能目录绝对路径

**用法**：被 @monou/agent-from-dir 与 apps 使用，用于定位或初始化 .first_paramecium 同构目录。

---

## 8. @monou/agent-from-dir

**职责**：从 agent 目录（.first_paramecium 或任意同构目录）加载并构建 session/context；运行逻辑在 app（gateway / TUI / scripts）侧。

**依赖**：@monou/agent-template、@monou/agent-sdk、@monou/agent-core、@monou/llm-provider。

**主要导出**：

- 从 agent-template 再导出：`ensureAgentDir`、`getAgentDir`、`getAgentSkillDirs`、`U_BASE_AGENT_ID`、`U_BASE_SKILL_NAMES`
- `buildSessionFromU(rootDir, options)`：构建 `AgentSession`（skills、SOUL、IDENTITY、cron 路径、gatewayInvoke 等）
- `createAgentContextFromU(session)`：返回 `{ state, config, streamFn }` 及工具执行上下文
- `runMemoryFlushTurn`、`MEMORY_FLUSH_DEFAULT_PROMPT`
- `loadSkillScriptTools`、`createSkillScriptExecutor`；类型 `AgentSession`、`GatewayInvoke`、`ScriptToolEntry`

**用法**：apps/agent、TUI、Gateway 只读能力（如 skills.status）等，均通过此包从 .first_paramecium 或指定目录加载。

```ts
import { buildSessionFromU, createAgentContextFromU } from "@monou/agent-from-dir";
const session = await buildSessionFromU(rootDir, { agentDir, gatewayInvoke });
const { state, config, streamFn } = createAgentContextFromU(session);
```

---

## 9. @monou/tui

**职责**：终端 UI 组件与差分渲染，用于 TUI 应用（apps/u-tui）。无 pi-mono 依赖。

**依赖**：get-east-asian-width、marked 等。

**主要导出**：TUI、ProcessTerminal、Component 等，供 TUI 应用（apps/u-tui）使用。

---

## 10. @monou/gateway

**职责**：Gateway 协议类型与客户端（callGateway），供 CLI/TUI/Control UI 等调用 ParameciumU Gateway。与「谁在跑服务端」解耦。

**依赖**：无（使用 ws）。

**主要导出**：

- 类型：`GatewayRequest`、`GatewayResponse`、`GatewayEvent`、`ErrorShape`、`ConnectIdentity`、`GatewayMethod`、`GatewayEventName`
- 常量：`GATEWAY_METHODS`、`GATEWAY_EVENTS`
- `callGateway(options)`：单次 WebSocket RPC（连 → 发 request → 收 response → 关）；`CallGatewayOptions` 含 url、method、params、timeoutMs 等

**用法**：

```ts
import { callGateway } from "@monou/gateway";
const jobs = await callGateway<{ jobs: unknown[] }>({
  url: "ws://127.0.0.1:9347",
  method: "cron.list",
  params: { includeDisabled: true },
});
```

---

## 构建顺序（根目录 build 脚本）

shared → agent-core → skills → cron → agent-sdk → agent-template → agent-from-dir → llm-provider → tui → gateway；随后构建 apps：TUI（u-tui）、agent、sandbox-node、gateway。

## 下一步

- 整体架构：[architecture](../concepts/architecture.md)
- Agent 目录与技能加载：[agent-directory](../concepts/agent-directory.md)
- 应用运行方式：[apps](./apps.md)
- 编码技能设计：[code-skill-design](../reference/code-skill-design.md)
