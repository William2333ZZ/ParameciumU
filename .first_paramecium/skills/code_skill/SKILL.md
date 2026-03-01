---
name: code_skill
description: 代码库发现与导航。提供 grep、glob、list、code_search（自然语言/关键词搜索）、apply_patch（V4A 多文件 diff），与 base_skill 的 read/edit/write 配合使用。
---

# Code Skill

在 base_skill 的 read / edit / write / bash 之外，提供**代码发现与批量修改**类工具。

## Tools

| Tool | Use |
|------|-----|
| **grep** | 按正则搜索文件内容，返回路径与行号。用于找函数、常量、错误码等。 |
| **glob** | 按 glob 模式匹配文件名（如 `**/*.tsx`），返回文件路径列表。 |
| **list** | 列出目录结构，可忽略 node_modules 等。不了解结构时先用 list 或 glob。 |
| **code_search** | 按自然语言或关键词搜索（多词 OR）。适合「找和 X 相关的代码」「哪里处理 Y」；与 grep 互补（grep 用正则精确搜）。 |
| **apply_patch** | 应用 V4A 格式多文件 diff（*** Add File:/*** Update File:/*** Delete File:）。适合单次多文件修改，与 OpenCode/IDE 兼容。 |

## Guidelines

- 已知**内容**要搜 → 用 **grep**（pattern + 可选 path/include）。
- 已知**文件名模式** → 用 **glob**（pattern + 可选 path）。
- 想先看**目录结构** → 用 **list**（path 可选，ignore 可选）。
- **自然语言/短语**搜索 → 用 **code_search**（query + 可选 path/include）。
- **多文件、结构化 diff** → 用 **apply_patch**（patch_text，V4A 格式）；单文件小改仍可用 **edit**（base_skill）。
- 编辑前先用 **read**（base_skill）读文件；改动用 **edit**、**write**（base_skill）或 **apply_patch**。
- 可并行调用多个 grep/glob/code_search 以批量探索。
