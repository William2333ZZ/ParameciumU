---
name: doc_export_skill
description: "Export solution content to a standard Word document (.docx). Use when the user says '输出word文档' / '导出Word' / '生成Word' / '下载Word'. Call generate_word_document with the current solution content, client name, and optional date."
---

# Doc Export Skill（Word 文档导出）

当用户要求**输出/导出/生成/下载 Word 文档**时，调用 **generate_word_document** 工具，将当前会话中已生成的解决方案正文渲染为规范 .docx 文件。

## 何时使用

- 用户说：「输出word文档」「导出Word」「生成Word」「下载Word」「给我一份Word」等。
- 当前对话中已有完整或可用的解决方案正文（六章结构），且已知客户名称（可从需求或用户输入中获取）。

## 工具

| 工具 | 说明 |
|------|------|
| **generate_word_document** | 将方案正文（content）、客户名称（clientName）、日期（可选）写入标准 .docx，文件命名：`解决方案_客户名称_日期.docx`，返回生成文件的路径供下载。 |

## 参数

- **content**（必填）：完整解决方案正文，建议为 Markdown 格式（含 # / ## / ### 标题与段落），与 document-structure 六章结构一致。
- **clientName**（必填）：客户名称，用于文件名与封面。
- **date**（可选）：日期，格式 YYYYMMDD；不传则使用当前日期。
- **outputDir**（可选）：输出目录绝对路径；不传则使用当前工作目录。

## 流程

1. 用户提供需求 → Agent 立即生成解决方案正文（六章）。
2. 用户说「输出word文档」→ Agent 调用 **generate_word_document**，传入**完整**方案 content、客户名、日期。
3. 工具返回生成文件的路径 → Agent 告知用户文件路径或下载方式。

## 故障排查

- **导出失败 / Cannot find module 'docx'**：在 **solution_agent** 目录下执行 `npm install` 安装 docx 依赖后再试。
- **内容不完整**：导出前确保方案正文已生成完整（六章及全部小节），勿传入被截断的 content。
