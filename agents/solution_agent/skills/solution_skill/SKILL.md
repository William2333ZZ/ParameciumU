---
name: solution_skill
description: "Requirement interpretation and solution document generation. Use when the user uploads or pastes customer requirements (Word/Excel or plain text), or asks to generate/revise a solution document. Always follow the 6-chapter template; support multi-turn iteration from conversation history."
---

# Solution Skill（解决方案技能）

负责从客户需求（文档或文字）中解读业务背景与痛点，并按**固定六章模板**生成或迭代解决方案内容。与文档生成层配合可输出规范 Word。

## 何时使用

- 用户上传/粘贴需求文档或输入需求描述 → **立即**解读需求并生成方案正文（六章）。**优先在一次回复中输出完整方案**，便于用户中途通过对话修改（如「改第 3 章」「把 2.1.2 写详细」）；仅当单次长度或上下文不足时再按 document-structure「分批生成与合并」分批写，写完后合并再导出。不要等用户再发一条才动笔。
- 用户要求「按意见修改」「调整第 X 章」→ 基于对话历史迭代方案
- 用户说「**输出word文档**」「导出Word」「生成Word」→ 调用 **doc_export_skill** 的 **generate_word_document** 工具，传入当前方案 content、客户名称、日期
- 用户询问文档结构、章节含义 → 引用本 skill 的 references

## 行为约束

1. **需求解读**：从输入中提炼——业务背景、现状、问题分析、建设目标、功能/非功能需求。
2. **方案结构**：严格按 [document-structure.md](references/document-structure.md) 的六章及小节生成，不增删一级章节。
3. **段落式正文**：每节须由**多段连贯的段落文字**组成（每段 3–6 句），有论述、有过渡；可适当配合小标题或列表，但禁止整节只写一句或只列要点。风格与 `solutions_file/0516监督评价智能体需求规划设计方案.docx` 一致，按 document-structure 的「详细要求」控制每节段落数与内容要点，输出可直接用于汇报或投标的正式方案。
4. **迭代**：修改时说明「已更新：…」，并保留与历史一致的客户名、日期等元信息。
5. **优先一次输出；必要时分批**：默认尽量一次输出完整方案，方便用户中途对话修改。仅当单次输出或上下文受限时，再按 document-structure「节单位」分批生成，全部节生成后按顺序合并为一份完整 Markdown 再导出。
6. **输出**：方案正文使用 Markdown 或结构化文本，便于渲染为 Word；可流式输出以提升体验。

## 参考资料

| 文件 | 用途 |
|------|------|
| [references/document-structure.md](references/document-structure.md) | 解决方案文档六章与小节定义 |
| [references/architecture.md](references/architecture.md) | 交互层 / AI 推理层 / 文档生成层分工 |

## 与其它层的关系

- **交互层**：提供上传、输入、下载入口；本 skill 不直接处理二进制文件，接收的是已提取的文本或用户输入。
- **文档生成**：当用户说「输出word文档」时，由 **doc_export_skill** 的 **generate_word_document** 工具将当前方案正文渲染为「解决方案_客户名称_日期.docx」并返回路径，供交互层提供下载。
