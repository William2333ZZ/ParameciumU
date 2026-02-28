# 知识库工作区布局

知识库的唯一天然来源是工作区下的 Markdown 文件。路径由运行环境决定：**默认当前项目的 `./.first_paramecium` 目录**（或环境变量 `KNOWLEDGE_WORKSPACE`）。

## 文件约定

| 路径（相对工作区根） | 用途 |
|----------------------|------|
| `KNOWLEDGE.md` | 可选，总览或单文件知识库。含 **## Add**（knowledge_add / knowledge_learn 无 topic 时追加）。 |
| `knowledge/*.md` | 按主题的单文件，如 `knowledge/faq.md`。 |
| `knowledge/<topic>/` | **主题目录**，topic 为文件夹名（如 股票、高中数学）。其下为**知识点**（.md 或子目录）。 |
| `knowledge/<topic>/<point>.md` | 知识点文件，如 `knowledge/股票/K线.md`、`knowledge/高中数学/函数.md`。point 可含子路径，如 `knowledge/股票/技术分析/形态.md`。 |
| `knowledge/<topic>/learned.md` | knowledge_learn 仅指定 topic 时的默认追加文件。 |
| `knowledge/index.sqlite` | 可选 FTS5 全文索引（+ 可选向量表），由 knowledge_sync 创建（Node 22+）。 |

## 检索与 path 白名单

- **knowledge_search** 会扫描（含 **topic** 时仅限 knowledge/<topic>.md 与 knowledge/<topic>/ 下）：
  - 工作区根下的 `KNOWLEDGE.md`、`knowledge.md`；
  - `knowledge/` 下所有 `.md` 及 **knowledge/** 下递归子目录中的 `.md`；
  - `KNOWLEDGE_EXTRA_PATHS`（逗号分隔）中的路径。
- **knowledge_get** 的 `path` 仅允许上述路径，禁止 `..` 或工作区外路径。

## 写入

- **knowledge_learn(text, topic?, point?, source?)**：有 topic+point → knowledge/<topic>/<point>.md；仅 topic → knowledge/<topic>/learned.md；否则 KNOWLEDGE.md ## Add。
- **knowledge_learn_from_urls(urls, topic?, point?)**：从 URL 抓取内容后按同上规则写入。
- **knowledge_add**：追加到 KNOWLEDGE.md 的 ## Add 或指定 path（如 knowledge/股票/K线.md）。
- 也可用 **write** / **edit** 直接编辑，可 git 管理、人工审阅。
