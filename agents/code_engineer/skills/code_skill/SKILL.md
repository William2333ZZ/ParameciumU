---
name: code_skill
description: 代码库发现与导航。提供 grep（内容搜索）、glob（文件名匹配）、list（目录列表），与 base_skill 的 read/edit/write 配合使用。
---

# Code Skill

在 base_skill 的 read / edit / write / bash 之外，提供**代码发现**类工具，便于按模式查找文件与内容。

## Tools

| Tool | Use |
|------|-----|
| **grep** | 按正则搜索文件内容，返回路径与行号。用于找函数、常量、错误码等。 |
| **glob** | 按 glob 模式匹配文件名（如 `**/*.tsx`），返回文件路径列表。 |
| **list** | 列出目录结构，可忽略 node_modules 等。不了解结构时先用 list 或 glob。 |

## Guidelines

- 已知**内容**要搜 → 用 **grep**（pattern + 可选 path/include）。
- 已知**文件名模式** → 用 **glob**（pattern + 可选 path）。
- 想先看**目录结构** → 用 **list**（path 可选，ignore 可选）。
- 编辑前先用 **read**（base_skill）读文件；改动用 **edit** 或 **write**（base_skill）。
- 可并行调用多个 grep/glob 以批量探索。
