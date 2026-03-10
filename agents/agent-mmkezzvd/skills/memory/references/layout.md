# 记忆工作区布局

记忆的唯一天然来源是工作区下的 Markdown 文件。路径由运行环境决定：**默认当前项目的 `./.first_paramecium` 目录**（或环境变量 `MEMORY_WORKSPACE`）。

## 文件约定

| 路径（相对工作区根） | 用途 |
|----------------------|------|
| `MEMORY.md` | 长期记忆：决策、偏好、重要事实。含 **## Store**（memory_store 追加）、**## Forgotten**（memory_forget 标记）。 |
| `memory/YYYY-MM-DD.md` | 按日日志，仅追加。例如 `memory/2025-02-10.md`。 |
| `memory/index.sqlite` | 可选 FTS5 全文索引（+ 可选向量表），由 memory_sync 创建（Node 22+）。 |

## 检索与 path 白名单

- **memory_search / memory_recall** 会扫描：
  - 工作区根下的 `MEMORY.md`、`memory.md`；
  - `memory/` 目录下所有 `.md`；
  - `MEMORY_EXTRA_PATHS`（逗号分隔）中的路径；
  - 若启用会话转录索引（`MEMORY_INDEX_SESSION=1`），还有 **session/transcript.md**（来自 `MEMORY_SESSION_PATH` 指定的会话 JSON，如 Gateway 导出的 transcript）。
- **memory_get** 的 `path` 仅允许上述路径（含 session/*.md，从索引读取），禁止 `..` 或工作区外路径。

## 写入

- **memory_store**：追加到 MEMORY.md 的 ## Store 或当日 memory/YYYY-MM-DD.md。
- **memory_forget**：追加到 MEMORY.md 的 ## Forgotten。
- 也可用 **write** / **edit** 直接编辑 MEMORY.md 或 memory/*.md，以 Markdown 为事实来源，可 git 管理、人工审阅。
