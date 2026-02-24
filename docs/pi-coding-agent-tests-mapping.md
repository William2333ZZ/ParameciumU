# pi coding-agent 测试在 monoU 的映射与集成方案

pi 的 coding-agent 本质是「从目录构建的 agent」，在 monoU 中对应 **agent-from-dir** 及底层包（agent-sdk、agent-core、skills、agent-template）。本文档说明 pi 各测试在 monoU 的归属与集成方式。

---

## 一、已覆盖（已移植或等价）

| pi 测试 | monoU 位置 | 说明 |
|--------|------------|------|
| **skills.test.ts** | `packages/skills/test/skills.test.ts` | loadSkillsFromDir、formatSkillsForPrompt、fixtures |
| **frontmatter.test.ts** | `packages/skills/test/frontmatter.test.ts` | parseFrontmatter |
| **compaction.test.ts** | `packages/agent-core/test/compaction.test.ts` | shouldCompact、findCutPoint、compactState、estimateMessagesTokens |
| **sdk-skills.test.ts** | `packages/agent-sdk/test/system-prompt-and-skills.test.ts` | createAgent + skillDirs、systemPrompt、skills 进 system message |
| **system-prompt.test.ts** | 同上 | 合并到 system-prompt-and-skills |
| **tools.test.ts** | 两处：① `packages/agent-template/test/tools.test.ts` 测 base_skill 源码；② `packages/agent-from-dir/test/build-session.test.ts` 测从目录 buildSession + executeTool | ① 单元；② 集成（pi 的「agent from dir」形态） |

---

## 二、建议在 monoU 集成的（与 agent-from-dir / 能力直接相关）

### 1. path-utils（路径解析）

- **pi**: `path-utils.test.ts`（expandPath、resolveToCwd、resolveReadPath）
- **monoU**: 当前 base_skill 的 `resolvePath` 在 tools 内联，无独立包。
- **建议**:
  - **选项 A**：在 `packages/agent-from-dir` 增加 `test/path-utils.test.ts`，若日后把 path 工具抽到 `agent-from-dir` 或 shared 再迁出。
  - **选项 B**：在 agent-template 的 base_skill 测试里顺带测「绝对路径 / 相对路径 / 缺失 path」；不单独建 path-utils 包，除非多处复用。

### 2. loadSkillScriptTools 行为（脚本技能发现）

- **pi**: 无直接同名测试，但 resource-loader / 技能发现逻辑有测。
- **monoU**: `loadSkillScriptTools`、`createSkillScriptExecutor` 在 agent-from-dir，已有 `build-session.test.ts` 里简单排除逻辑测试。
- **建议**：在 `packages/agent-from-dir/test/build-session.test.ts` 或新建 `load-skill-script-tools.test.ts` 增加：
  - 仅含单脚本 `.sh` / `.py` 的 skill 目录 → 出现 1 个 script tool、name/description 正确；
  - 无 scripts 或 scripts 下无单脚本 → 无该 skill 的 script tool；
  - excludeDirNames 正确排除 base_skill 等。

### 3. prompt-templates（若 monoU 引入该能力）

- **pi**: `prompt-templates.test.ts`（parseCommandArgs、substituteArgs、$1/$2/$@/$ARGUMENTS）
- **monoU**: 当前无对应包。
- **建议**：若在 monoU 做「提示词模板 + 参数替换」，再在对应包（如 skills 或新包）下移植用例；否则暂不集成。

### 4. agent-session 与 compaction 结合

- **pi**: `agent-session-compaction.test.ts` 等测「会话 + 自动 compaction」。
- **monoU**: compaction 在 agent-core；createAgentContextFromU 里已有 compaction 调用。
- **建议**：在 `packages/agent-from-dir` 增加「集成小用例」：build 出 context（或 mock session），state 超 token 阈值后触发 compact，断言 summary system message 存在、recent 保留（可 mock completeFn），不必复刻 pi 的 session 持久化。

---

## 三、不移植或延后（pi 特有 / TUI / 非「agent from dir」核心）

| pi 测试 | 说明 |
|--------|------|
| session-manager/*, session-selector-*, agent-session-tree-*, agent-session-branching 等 | Session 树、持久化、迁移、标签、文件操作——pi 的 TUI/桌面会话模型；monoU 若做会话层再单独设计测试。 |
| extensions-*, resource-loader.test.ts | 扩展加载、资源发现——pi 架构；monoU 暂无对等扩展体系。 |
| model-resolver, model-registry, package-manager*, package-command-paths | 模型解析、包管理、命令路径——pi 运行环境；monoU 用 llm-provider 等，可日后按需补测。 |
| compaction-thinking-model, compaction-extensions* | 思考模型、扩展式 compaction——pi 增强；monoU compaction 目前为基础版，可后续按需加。 |
| image-processing, clipboard-image*, block-images | 图像处理、剪贴板——UI/平台相关，非 agent-from-dir 核心。 |
| git-*, auth-storage, args.test.ts, settings-manager*, interactive-mode-status | Git、认证、参数解析、设置、交互状态——应用层；若 monoU 有对应功能再补测。 |
| truncate-to-width, tree-selector | TUI 展示与选择——不纳入 agent-from-dir 测试。 |

---

## 四、集成方式与执行

### 1. 测试放置原则

- **agent-from-dir**：所有「从目录构建 session/context、工具发现与执行、compaction 与 session 结合」的集成测试；fixture 用 `test/fixtures/minimal-u` 或扩展（如带 script skill 的目录）。
- **agent-sdk**：createAgent、runAgentTurn、runAgentTurnWithTools、systemPrompt+skillDirs、e2e（如 bianxie）。
- **agent-core**：compaction、loop、state（无 IO 的纯逻辑）。
- **skills**：load、format、frontmatter。
- **agent-template**：仅测模板内「可执行单元」（如 base_skill 的 tools.ts），不负责从目录加载。

### 2. 运行方式

- 单包：`cd packages/agent-from-dir && npm run test`
- 全仓库：根目录 `npm run test`（workspaces --if-present）

### 3. 建议新增的测试文件（按优先级）

1. **agent-from-dir/test/load-skill-script-tools.test.ts**  
   - fixture：一个仅含 `scripts/foo.sh` 且无 `tools.js`/`tools.ts` 的 skill 目录；  
   - 断言：`loadSkillScriptTools` 返回 1 个 tool、name 来自目录名、description 来自 SKILL.md；  
   - 断言：`createSkillScriptExecutor` 调用该脚本得到预期输出（或 exit 0）。

2. **agent-from-dir/test/build-session.test.ts**（已有）  
   - 可选增：compaction 集成用例（见上文「agent-session 与 compaction 结合」）。

3. **path 行为**（可选）  
   - 若在 agent-from-dir 或 shared 中抽出 path 工具，再加 `path-utils.test.ts`；否则用现有 read/write 测试中的路径用例即可。

---

## 五、小结

- **已覆盖**：skills、frontmatter、compaction、sdk-skills/system-prompt、tools（单元 + 集成）。
- **建议补**：loadSkillScriptTools 的「单脚本 skill 发现 + 执行」、可选 compaction 集成用例、按需 path-utils。
- **不移植**：session 树/持久化、扩展、模型/包管理、图像/TUI、Git/认证等 pi 特有层，等 monoU 有对应功能再设测试。

按上述分工，pi coding-agent 中与「agent from dir」直接相关的测试，都能在 monoU 中有明确归属和集成方式；其余保留在 pi 或等 monoU 功能对齐后再移植。
