---
name: knowledge
description: "工作区知识库的检索、自学习（topic/知识点 + 从 URL 抓取）与知识转 Skill。topic 为文件夹，其下为知识点（如 股票/K线、高中数学/函数）；可 web_search + knowledge_learn_from_urls 自主学习。"
---

# Knowledge

在工作区 Markdown 知识库中检索、按片段读取、**自学习**（按**主题文件夹 + 知识点**写入，或从 URL 抓取），以及**将某类知识转化为 Skill**。事实以文件为准；只有写入磁盘的内容可被检索。

## 何时使用

- 用户询问「根据文档/知识库……」「项目里怎么配置……」「FAQ 里有没有……」时，**先调用 knowledge_search**（可选 **topic** 限定主题），再视情况 **knowledge_get** 拉取片段。
- 用户说「**学习这段内容**」「把这段话记进股票 K 线」：用 **knowledge_learn(text, topic?, point?)**，topic 为文件夹（如 股票），point 为知识点（如 K线）。
- 用户说「**学习一下 K 线知识**」「帮我联网学股票」：先 **web_search** 获取链接，再用 **knowledge_learn_from_urls(urls, topic, point)** 抓取并写入（自主学习）。
- 列出主题 / 某主题下知识点：**knowledge_list_topics**、**knowledge_list_points(topic)**。
- 用户说「把这条记进知识库」或单条追加：用 **knowledge_add** 追加到 KNOWLEDGE.md 或指定 path。
- 用户说「**把股票知识转成 skill**」：用 **knowledge_skill_create(topic, description?)**，之后 run 会注册 `<topic>_knowledge_search`（如 股票_knowledge_search）。
- 大量修改知识库文件后：调用 **knowledge_sync** 重建 FTS5 索引（需 Node 22+）。

## 工作区布局

知识库文件位于**当前项目的 ./.u 目录下**（或环境变量 `KNOWLEDGE_WORKSPACE` 指定）：

- **.u/KNOWLEDGE.md**：可选，总览或单文件知识库；**## Add** 为无 topic 时的追加区。
- **.u/knowledge/**：按**主题**组织。可为单文件（如 `knowledge/faq.md`）或**主题目录**（如 `knowledge/股票/`），其下为**知识点**：`knowledge/股票/K线.md`、`knowledge/高中数学/函数.md` 等。

可选 FTS5 索引：**.u/knowledge/index.sqlite**（或 `KNOWLEDGE_INDEX_PATH`），由 **knowledge_sync** 创建/重建；Node 22+ 时 knowledge_search 会优先使用索引。可选**向量混合检索**（`KNOWLEDGE_EMBEDDING_ENABLED=1` + `EMBEDDING_API_KEY`）。

详见 [references/layout.md](references/layout.md)。

## 工具

### knowledge_search

在 KNOWLEDGE.md、knowledge/ 下所有 .md（含子目录，及 `KNOWLEDGE_EXTRA_PATHS`）中搜索。可选 **topic** 时仅在该主题下检索（knowledge/<topic>.md 或 knowledge/<topic>/ 下所有 .md）。若有 FTS5 索引则全文检索；若启用 embedding 则与向量检索混合，否则回退到文件关键词扫描。

- **query**（必填）：搜索词或短语。
- **topic**（可选）：仅在该主题下检索，如 股票、高中数学，对应 knowledge/<topic>.md 或 knowledge/<topic>/。
- **maxResults**（可选）：最多返回条数，默认 10。
- 返回：`results[]`（path、startLine、endLine、snippet、score）、`provider`、`topic`。

### knowledge_get

按 path 与可选行范围读取片段。**仅允许** KNOWLEDGE.md、knowledge.md、knowledge/ 下任意 .md（含 knowledge/<topic>/<point>.md）及 `KNOWLEDGE_EXTRA_PATHS` 内路径。

- **path**（必填）：相对工作区的路径。
- **from**（可选）：起始行号（1-based）。
- **lines**（可选）：读取行数。

### knowledge_sync

重建 FTS5 索引（.u/knowledge/index.sqlite）。需 Node 22+（node:sqlite）；否则返回错误，knowledge_search 仍可用文件扫描回退。若 `KNOWLEDGE_EMBEDDING_ENABLED=1` 且配置了 `EMBEDDING_API_KEY`，会同时写入向量以启用混合检索。

### knowledge_add

将一条知识追加到 KNOWLEDGE.md 的 ## Add 区块或指定 knowledge/<topic>.md。用于「把这条记进知识库」。

- **text**（必填）：要存储的知识内容。
- **path**（可选）：相对路径，如 `knowledge/faq.md`；不传则追加到 KNOWLEDGE.md 的 ## Add。

### knowledge_learn

**自学习**：将一段文本写入知识库。**topic** 为文件夹（如 股票、高中数学），**point** 为知识点子路径（如 K线、几何/解析几何）。有 topic+point → knowledge/<topic>/<point>.md；仅 topic → knowledge/<topic>/learned.md；否则 KNOWLEDGE.md。学习后建议 **knowledge_sync**。

- **text**（必填）：要学习的文本内容。
- **topic**（可选）：主题（文件夹名），如 股票、高中数学。
- **point**（可选）：知识点（子路径），如 K线、技术分析/形态。
- **source**（可选）：来源标记，如 url 或 conversation。

### knowledge_list_topics

列出当前知识库中的主题：knowledge/ 下的 .md 文件名（去 .md）与子目录名（如 股票、高中数学、faq）。便于选择 topic 或决定是否将某类知识转为 Skill。

### knowledge_list_points

列出某主题下的**知识点**：knowledge/<topic>/ 下的文件名（去 .md）与子目录名（子目录以 / 结尾）。如 topic=股票 返回 [K线, 基本面, 技术分析/]。用于了解该主题下已有结构。

- **topic**（必填）：主题名，如 股票、高中数学。

### knowledge_learn_from_urls

从指定 **URL 列表**抓取页面内容并写入知识库（可指定 topic/point）。用于**自主学习**：先 **web_search** 获取相关链接，再调用本工具将内容沉淀到知识库。

- **urls**（必填）：要抓取的 URL 数组。
- **topic**（可选）：主题（文件夹），如 股票、高中数学。
- **point**（可选）：知识点（子路径），如 K线。
- **maxContentPerUrl**（可选）：每个 URL 最多取字符数，默认 30000。

### knowledge_skill_create

将某一主题的**知识转化为 Skill**。创建 `.u/skills/<topic>_knowledge/`（SKILL.md + topic.json），之后 run 会自动注册 **&lt;topic&gt;_knowledge_search**（如 stock_knowledge_search），仅在该主题知识库中检索。用于「把股票知识转成 skill」。

- **topic**（必填）：主题名，如 stock、faq，将生成 &lt;topic&gt;_knowledge 目录。
- **description**（可选）：Skill 描述，如「股票、行情、K 线、基本面」。

## 自学习与知识转 Skill

1. **按主题+知识点学习**：用 **knowledge_learn(text, topic, point)**，如 topic=股票、point=K线 → knowledge/股票/K线.md；可多次调用形成文件结构（高中数学/函数、股票/技术分析/形态 等）。
2. **自主学习（联网）**：用户说「学习一下 K 线」时，先 **web_search("K线 入门")** 获取链接，再 **knowledge_learn_from_urls(urls, topic=股票, point=K线)** 抓取并写入。
3. **列出主题与知识点**：**knowledge_list_topics** 看有哪些主题；**knowledge_list_points(topic)** 看某主题下有哪些知识点。
4. **转为独立 Skill**：**knowledge_skill_create(topic, description)** 后，下次 run 会出现 **&lt;topic&gt;_knowledge_search**（如 股票_knowledge_search），仅在该主题目录下检索。

## 流程建议

1. 问题涉及「文档、知识库、怎么配、FAQ」等 → **knowledge_search**（可选 topic）；若已有某主题的 knowledge skill → 用 **&lt;topic&gt;_knowledge_search**。
2. 结果非空时按需 **knowledge_get(path, from, lines)**。
3. 用户说「学习这段」→ **knowledge_learn(text, topic?, point?)**；用户说「联网学某主题」→ **web_search** 再 **knowledge_learn_from_urls(urls, topic, point)**；单条追加 → **knowledge_add(text, path)** 或 **write**。
4. 用户说「把某类知识转成 skill」→ **knowledge_skill_create(topic, description)**。
5. 大量改过知识库文件且 Node 22+ → **knowledge_sync** 以启用/刷新 FTS5。

## 与 memory 的区别

- **memory**：过往发生的事、决策、偏好、人物、待办、日期（MEMORY.md、memory/YYYY-MM-DD.md）。
- **knowledge**：参考资料、文档、FAQ、如何做、概念与事实（KNOWLEDGE.md、knowledge/*.md）。回答「之前说过」用 memory，回答「根据文档/知识库」用 knowledge。

## 环境变量

| 变量 | 说明 |
|------|------|
| `KNOWLEDGE_WORKSPACE` | 工作区根目录，默认 `./.u` |
| `KNOWLEDGE_INDEX_PATH` | FTS5 索引文件路径，默认 `.u/knowledge/index.sqlite` |
| `KNOWLEDGE_EXTRA_PATHS` | 逗号分隔的额外路径（相对工作区或绝对），纳入检索与 path 白名单 |
| `KNOWLEDGE_EMBEDDING_ENABLED` | `1` 或 `true` 时在 knowledge_sync 时写入向量并启用混合检索 |
| `EMBEDDING_API_KEY` | 嵌入 API 密钥（与 memory 共用）；未设时可用 `OPENAI_API_KEY` |
| `EMBEDDING_BASE_URL` | 嵌入 API 根 URL |
| `EMBEDDING_MODEL` | 嵌入模型名 |
| `KNOWLEDGE_VECTOR_WEIGHT` | 混合检索时向量权重（0–1），默认 0.7 |
| `KNOWLEDGE_TEXT_WEIGHT` | 混合检索时全文权重（0–1），默认 0.3 |

## Resources

- [references/layout.md](references/layout.md) — 知识库工作区目录与文件约定。
