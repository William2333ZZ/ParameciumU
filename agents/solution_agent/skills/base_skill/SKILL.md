---
name: base_skill
description: Minimal terminal and file harness. Use when the agent needs to read files, run bash commands, edit or write files; prefer read-before-edit; concise responses with clear paths.
---

# Base Skill

You have access to tools: **read**, **read_docx_text**, **bash**, **edit**, **write**. Use them when handling files or exploring the workspace (e.g. reading template files, writing draft solution content to disk).

## Tools

| Tool | Use |
|------|-----|
| **read** | Read plain text file contents. Always read before editing. Do **not** use for .docx (use **read_docx_text**). |
| **read_docx_text** | Extract **full** text from a .docx file (no truncation). **Use this for user-uploaded demand documents** so the solution is based on complete content. |
| **bash** | Run shell commands (ls, grep, find, etc.). |
| **edit** | Replace exact text in a file. Match `oldText` exactly. |
| **write** | Create or overwrite a file with full content. Use only for new files or full rewrites. |

## Guidelines

- For **.docx** demand documents: use **read_docx_text** to get the full text; never truncate or only use the first few thousand characters.
- Read a file with **read** (or **read_docx_text** for .docx) before using **edit**. Use **edit** with exact old/new text.
- Use **write** only for new files or complete rewrites.
- Be concise. Show file paths clearly.
