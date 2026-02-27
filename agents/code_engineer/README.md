# code_engineer Agent

专注代码库探索与实现的编码 Agent，行为对齐 OpenCode 的 build 模式（任务拆解、专用工具优先、并行调用、简洁执行）。

## 工具

- **base_skill**：read、bash、edit、write
- **code_skill**：grep、glob、list、code_search、apply_patch
- **todo_skill**：todowrite、todoread（任务拆解与勾选）

## 运行

连接 Gateway 时指定本目录与 ID：

在 Control UI 或 RPC 中选择 agentId: code_engineer 即可把对话派发到本 agent。

## 与 OpenCode 能力对齐


| 能力                                             | 状态           | 说明                                                    |
| ---------------------------------------------- | ------------ | ----------------------------------------------------- |
| read / edit / write / bash                     | ✅ base_skill | 已有                                                    |
| grep / glob / list / code_search / apply_patch | ✅ code_skill | 已有；code_search 为关键词/自然语言搜索，apply_patch 为 V4A 多文件 diff |
| **todowrite / todoread**                       | ✅ todo_skill | 任务拆解与勾选，与 OpenCode 一致                                 |
| web_fetch / web_search                         | ✅ web_skill  | 模板已带，查文档/搜网                                           |
| 任务拆解、专用工具优先、并行、path:line                       | ✅ SOUL.md    | 原则已写                                                  |
| Task（子 agent）                                  | ⚪ 暂无         | 用 grep/glob/code_search/list 先探索再读改                   |


达到与 OpenCode build 模式同等能力：**确保本 agent 带 base_skill + code_skill + todo_skill**；可选保留 web_skill 以便查文档。详见 [docs/reference/code-skill-design.md](../../docs/reference/code-skill-design.md)。

## 说明

- SOUL.md、IDENTITY.md 定义原则与身份；首次运行若目录不完整，会从模板补齐其他 skills（如 memory、cron、todo_skill），本 agent 以 base_skill + code_skill + todo_skill 为主。
- 详见 [docs/reference/code-skill-design.md](../../docs/reference/code-skill-design.md)。

