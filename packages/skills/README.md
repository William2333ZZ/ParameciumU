# @monou/skills

Agent Skills: load SKILL.md from directories and format for system prompt (Agent Skills spec). File-system only, no external runtime dependency.

## Discovery

- Root: direct `.md` files in the skills directory.
- Recursive: `SKILL.md` under subdirectories.
- Ignores: `node_modules`, dot-prefixed files/dirs.

## loadSkills options

- **agentDir** — Agent root (in monoU, `.u` or any same-structure dir). When `includeDefaults` is true, loads from `agentDir/skills`. Callers should pass this explicitly in monoU.
- **cwd** — Working directory for resolving relative paths; default `process.cwd()`.
- **skillPaths** — Extra paths (files or directories) to load.
- **includeDefaults** — If true (default), load from `agentDir/skills` and, when `cwd` is set, from a legacy config dir under cwd (optional). For monoU, passing `agentDir` is enough.

## Usage

```ts
import { loadSkills, loadSkillsFromDir, formatSkillsForPrompt } from "@monou/skills";
import path from "node:path";

// monoU: load from .u/skills
const result = loadSkills({ agentDir: path.join(process.cwd(), ".u") });
const promptFragment = formatSkillsForPrompt(result.skills);
// Append promptFragment to system prompt
```

## Skill structure

Directory with `SKILL.md`:

```yaml
---
name: my-skill
description: Does something useful.
disable-model-invocation: false
---
Full instructions (markdown)...
```

## Skill tools (optional, in agent-sdk)

除 prompt（SKILL.md）外，skill 目录可提供**工具定义与执行器**：

- Skill 目录下可有 `scripts/tools.js`（或 `tools.js`、`tools/index.js`），导出 `tools: AgentTool[]` 与可选的 `executeTool(name, args)`。
- 使用方：`@monou/agent-sdk` 的 `loadToolsFromSkillDir` / `loadToolsFromSkillDirs(skillDirs)` 可加载并合并各 skill 的 tools 与 executeTool；或由 runner 直接 import 后传入 `createAgent({ tools })` 与 `runAgentTurnWithTools(..., executeTool)`。
- 在 monoU 中，agent-from-dir 会从 agent 目录的各 skill 下加载 `scripts/tools.ts`（或 .js）并统一注册。
