# 技能库：为新建 Agent 选择技能

新建 Agent 时，不依赖「整份复制 .u」；可从**技能库**中选择需要的技能，复制到该 Agent 的 `skills/` 目录。

## 模板技能（agent-template 必备）

以下技能在 `packages/agent-template/template/skills/` 和 monoU `.u/skills/` 中均有，Agent 至少需要前三个才能正常运行：

| 技能名       | 说明                     | 建议 |
|-------------|--------------------------|------|
| base_skill  | 基础工具（读文件、执行等） | 必选 |
| memory      | 记忆读写与检索           | 必选 |
| cron        | 定时任务                 | 必选 |
| skill-creator | 创建/更新其他技能       | 按需 |

## 可选技能

- 当前 `.u/skills/` 下除上述外的目录（若有 `SKILL.md` 即为一门技能），可按需复制到新 Agent 的 `skills/`。
- 从零新建 Agent 时，从 `packages/agent-template/template/skills/` 复制 `base_skill`、`memory`、`cron`（及可选 `skill-creator`）到 `AGENT_DIR/skills/`，保证目录名与内层结构一致（含 `scripts/`、`references/`、`SKILL.md` 等）。

## 如何「从技能库选择」

1. **基于 .u 定制**：在复制好的 `.u` 基础上，在 `skills/` 中增删子目录（从模板或现有 skills 复制）。
2. **从零新建**：先建好 `AGENT_DIR/skills/`，再从模板或 `.u/skills/` 中复制上述必备技能目录；再按需复制 skill-creator 或其他技能。
3. 不要只复制 SKILL.md 而漏掉 `scripts/`、`references/`；否则工具或引用会缺失。

## agent-creator 技能本身

本技能（agent-creator）用于「创建并启动 Agent」，通常放在 .u 的 skills 里供「当前 Agent」调用，而不是必须复制到每个新建的 Agent。若希望新建的 Agent 也能创建子 Agent，可将 agent-creator 一并复制到其 `skills/`。
