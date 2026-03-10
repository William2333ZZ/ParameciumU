---
name: memory
description: "工作区长期记忆的检索、读取与写入，持久化在 ./.first_paramecium 下。工具：memory_search、memory_get、memory_store、memory_recall、memory_forget、memory_sync。短期/多轮由 state.messages 提供；跨会话用 memory_store 或 write 写入后用 memory_search 回忆。"
---

# Memory

在工作区 Markdown 记忆文件中检索、按片段读取，以及写入/遗忘标记。事实以文件为准；只有写入磁盘的内容可被 recall。

## 何时使用

- 用户询问“之前我们说过/决定过……”、“我的偏好……”、历史待办或日期/人物相关问题时，**先调用 memory_search 或 memory_recall**，再视情况 **memory_get** 拉取片段。
- 用户说“记住这个”或需要持久化一条信息时：用 **memory_store** 写入 MEMORY.md 或当日 memory/YYYY-MM-DD.md。
- 需要标记某条内容为“待遗忘”时：用 **memory_forget** 追加到 MEMORY.md 的 ## Forgotten，供人工审阅。
- 大量修改记忆文件后希望加速检索：调用 **memory_sync** 重建 FTS5 索引（需 Node 22+）。

## 工作区布局

记忆文件位于**当前项目的 ./.first_paramecium 目录下**（或环境变量 `MEMORY_WORKSPACE` 指定）：

- **.first_paramecium/MEMORY.md**：长期记忆、决策与偏好；**## Store** 为 memory_store 追加区，**## Forgotten** 为 memory_forget 标记区。
- **.first_paramecium/memory/YYYY-MM-DD.md**：按日日志，仅追加。

可选 FTS5 索引：**.first_paramecium/memory/index.sqlite**（或 `MEMORY_INDEX_PATH`），由 **memory_sync** 创建/重建；Node 22+ 时 memory_search 会优先使用索引。可选**向量混合检索**（`MEMORY_EMBEDDING_ENABLED=1` + `EMBEDDING_API_KEY`）与 **会话转录索引**（`MEMORY_INDEX_SESSION=1`）。

详见 [references/layout.md](references/layout.md)。

## 工具

### memory_search

在 MEMORY.md、memory/*.md（及 `MEMORY_EXTRA_PATHS`）、可选 **session/transcript.md**（会话转录）中搜索。若有 FTS5 索引则全文检索；若启用 embedding 则与向量检索混合（FTS + 向量权重可配置），否则回退到文件关键词扫描。

- **query**（必填）：搜索词或短语。
- **maxResults**（可选）：最多返回条数，默认 10。
- 返回：`results[]`（path、startLine、endLine、snippet、score）、`provider`（hybrid / fts5 / vector / file-keyword）。

### memory_get

按 path 与可选行范围读取片段。**仅允许** MEMORY.md、memory.md、memory/*.md、**session/*.md**（转录，从索引读取）及 `MEMORY_EXTRA_PATHS` 内路径。

- **path**（必填）：相对工作区的路径。
- **from**（可选）：起始行号（1-based）。
- **lines**（可选）：读取行数。

### memory_store

将一条记忆追加到 MEMORY.md 的 ## Store 或当日 memory/YYYY-MM-DD.md。

- **text**（必填）：要存储的内容。
- **target**（可选）：`longterm`（默认，写 MEMORY.md）或 `daily`（写当日 memory/YYYY-MM-DD.md）。

### memory_recall

与 memory_search 语义相同，用于“回忆”类查询。

### memory_forget

将一条“待遗忘”标记追加到 MEMORY.md 的 ## Forgotten，不删除原文，仅供人工审阅或后续过滤。

- **text**（必填）：要标记遗忘的内容简述。

### memory_sync

重建 FTS5 索引（.first_paramecium/memory/index.sqlite）。需 Node 22+（node:sqlite）；否则返回错误，memory_search 仍可用文件扫描回退。若 `MEMORY_EMBEDDING_ENABLED=1` 且配置了 `EMBEDDING_API_KEY`，会同时写入向量到索引以启用混合检索；若 `MEMORY_INDEX_SESSION=1`，会将 `MEMORY_SESSION_PATH` 指定的会话 JSON（如 Gateway 导出的 transcript 文件）纳入索引，路径为 session/transcript.md。

## 压缩前记忆刷新

在会话接近上下文压缩前，可运行**一轮静默回合**，提示模型把持久记忆写入磁盘。用法（在 run 或 Gateway 层）：在即将压缩前调用 `runMemoryFlushTurn(session, state, config, streamFn, { prompt?: string })`（从 `@monou/agent-from-dir` 导出），用返回的 state 继续后续逻辑并再做压缩。默认 prompt 为："Session nearing compaction. Write any lasting notes to MEMORY.md or memory/YYYY-MM-DD.md now. Reply with NO_REPLY if nothing to store."

## 短期记忆与多轮对话

- **同一会话内的多轮**：由运行时的 `state.messages` 自动保留，无需额外工具。
- **跨会话**：用 **memory_store** 或 **write** 将要点写入 MEMORY.md / memory/YYYY-MM-DD.md，之后用 **memory_search** 回忆。

详见 [references/short-term-memory.md](references/short-term-memory.md)。

## 流程建议

1. 问题涉及“以前、上次、偏好、待办”等 → **memory_search** 或 **memory_recall**。
2. 结果非空时按需 **memory_get(path, from, lines)**。
3. 需持久化新信息 → **memory_store(text, target)** 或 **write**。
4. 大量改过记忆文件且 Node 22+ → **memory_sync** 以启用/刷新 FTS5。

## 环境变量

| 变量 | 说明 |
|------|------|
| `MEMORY_WORKSPACE` | 工作区根目录，默认 `./.first_paramecium` |
| `MEMORY_INDEX_PATH` | FTS5 索引文件路径，默认 `.first_paramecium/memory/index.sqlite` |
| `MEMORY_EXTRA_PATHS` | 逗号分隔的额外路径（相对工作区或绝对），纳入检索与 path 白名单 |
| `MEMORY_EMBEDDING_ENABLED` | `1` 或 `true` 时在 memory_sync 时写入向量并启用混合检索 |
| `EMBEDDING_API_KEY` | 嵌入 API 密钥（OpenAI 兼容）；未设时可用 `OPENAI_API_KEY` |
| `EMBEDDING_BASE_URL` | 嵌入 API 根 URL，默认 `https://api.openai.com/v1` |
| `EMBEDDING_MODEL` | 嵌入模型名，默认 `text-embedding-3-small` |
| `MEMORY_VECTOR_WEIGHT` | 混合检索时向量权重（0–1），默认 0.7 |
| `MEMORY_TEXT_WEIGHT` | 混合检索时全文权重（0–1），默认 0.3 |
| `MEMORY_INDEX_SESSION` | `1` 或 `true` 时 memory_sync 将会话转录纳入索引（实验性） |
| `MEMORY_SESSION_PATH` | 可选。会话 JSON 路径（需为 `[{ role, content }]` 数组），如 Gateway transcript 导出；会话由 Gateway 管理时可按需指向导出文件。 |

## Resources

- [references/layout.md](references/layout.md) — 工作区目录与文件约定。
- [references/short-term-memory.md](references/short-term-memory.md) — 短期记忆与多轮对话说明。
