# 智能体目录

ParameciumU 中的智能体是一个具有**固定结构**的**目录**。运行时（`@monou/agent-from-dir`）从此目录加载身份、原则、记忆、知识与技能。本文依据 `packages/agent-template` 与 `packages/agent-from-dir` 编写。

## 默认路径与 ID

- **默认目录名**：`.first_paramecium`（在 `@monou/agent-template` 中导出为 `DEFAULT_AGENT_DIR`）。
- **默认基础智能体 ID**：`U_base`（`U_BASE_AGENT_ID`）。启动 Agent 应用时通过 `AGENT_ID` 与 `AGENT_DIR` 显式指定；运行时没有默认智能体目录。

## 确保智能体目录存在

- **getAgentDir(rootDir)**  
  返回 `path.join(path.resolve(rootDir), ".first_paramecium")`。

- **ensureAgentDir(options)**  
  - `options.rootDir`：工作区根目录（默认 `process.cwd()`）。  
  - `options.agentDir`：直接指定智能体目录路径（与 rootDir 二选一）。  
  - `options.forceSync`：为 true 时用模板覆盖已有目录；否则只补齐模板中有而目录中缺失的项。  
  若目录不存在，会从 `@monou/agent-template/template` 复制模板并创建。返回解析后的智能体目录路径。

## 根目录文件

| 文件 | 用途 |
|------|------|
| `IDENTITY.md` | 智能体身份。注入系统提示中的「你的 IDENTITY」。 |
| `SOUL.md` | 原则与边界。注入为「你的 SOUL」。 |
| `MEMORY.md` | 长期记忆：**## Store**（仅追加）、**## Forgotten**（待遗忘标记）。供 memory 技能使用。 |
| `KNOWLEDGE.md` | 可选；**## Add** 为 knowledge_add / knowledge_learn 在未指定 topic 时的默认追加区。 |
| `cron/jobs.json` | Cron 任务存储，见 [Cron](./cron.md)。 |

技能使用的其他路径（见模板内技能文档）：

- `memory/YYYY-MM-DD.md` — 按日日志。  
- `knowledge/` — 按主题的知识（如 `knowledge/<topic>/<point>.md`）。  
- `memory/index.sqlite`、`knowledge/index.sqlite` — 可选 FTS5（及可选向量）索引。

## 技能目录

- **路径**：智能体目录下的 `skills/`。
- **发现**：运行时列出 `skills/` 下包含 `SKILL.md` 的子目录作为技能；同时通过 `getAgentSkillDirs(agentDir, { asAgentDir: true })` 解析模板中的基础技能路径（即 `U_BASE_SKILL_NAMES` 中各项）。

**基础技能名**（`U_BASE_SKILL_NAMES`）：  
`base_skill`、`code_skill`、`todo_skill`、`skill-creator`、`agent-creator`、`memory`、`knowledge`、`cron`、`web_skill`、`browser_skill`、`message_skill`、`sessions_skill`、`gateway_skill`。

每个技能可包含：

- **SKILL.md** — 给模型的描述与使用说明。  
- **scripts/tools.ts**（或 **tools.js**）— 定义工具及 executeTool 风格的处理函数。运行时加载并合并工具；按工具名路由执行（memory_*、knowledge_*、cron_*、code_*、todo_*、web_*、browser_*、message_*、sessions_*、gateway_* 及其他技能的脚本工具）。

主题知识：`skills/` 下名为 `<topic>_knowledge` 的目录（含 `SKILL.md` 与可选 `topic.json`）会注册工具 `<topic>_knowledge_search`，仅在该主题知识库中搜索。由 knowledge 技能的 `knowledge_skill_create` 创建。

## 会话如何构建

1. **智能体目录** 通过 `ensureAgentDir` 解析（或在使用 `skipEnsureAgentDir` 且提供 `agentDir` 时直接使用路径）。
2. **技能目录** = 基础技能目录（来自 `U_BASE_SKILL_NAMES`）+ `skills/` 下含有 `SKILL.md` 的发现目录。
3. **工具** 从各技能的 `scripts/tools.ts`（或 `.js`）加载；memory、knowledge、cron、web、browser、message、sessions、gateway、code、todo 及脚本工具合并后按名称执行。
4. **系统提示** 包含 SOUL 与 IDENTITY：`build-session.ts` 中的 `readSoulAndIdentity(agentDir)` 读取智能体目录下的 `SOUL.md` 与 `IDENTITY.md` 并注入。

LLM 配置来自环境变量（如 `BIANXIE_*`、`AIHUBMIX_*`、`OPENAI_*`）。流式函数与 agent 循环配置在 `createAgentContextFromU` 中创建；实际回合由 `@monou/agent-sdk` 的 `runAgentTurnWithTools` 执行。

## 工作区与 cron 存储

- **工作区根**（如启动 Gateway 时的 `process.cwd()`）用于默认智能体的 cron 存储路径（如该根下的 `.first_paramecium/cron/jobs.json`）。
- **Agent 进程** 使用 `AGENT_DIR` 定位该智能体的 `cron/jobs.json` 并运行调度器执行到期任务（如 Heartbeat）。

完整工具列表与文件布局见 `packages/agent-template/template/skills/` 下各技能的 `SKILL.md`。
