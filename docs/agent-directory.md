# Agent 目录约定（L4 定义层）

> 与执行过程、Heartbeat 的整合说明见 [agent-running.md](./agent-running.md)。

智能体在 monoU 中由**符合约定结构的文件夹**定义。只要目录在，智能体就可被任何兼容运行时加载、备份、迁移。本文档描述该约定（L4 定义层）。

## 一、目录结构（与 .u 同构）

任一 Agent 根目录（如 `.u` 或 `agents/sidekick`）建议包含：

```
<agent_root>/
├── SOUL.md           # 灵魂：原则、边界、气质；每轮注入 system prompt
├── IDENTITY.md       # 身份：名字、类型、可对外展示的档案
├── skills/           # 技能目录
│   ├── base_skill/
│   ├── memory/
│   ├── cron/
│   ├── skill-creator/
│   ├── knowledge/    # knowledge 技能（SKILL.md、scripts/tools.ts）
│   └── ...
├── memory/           # 可选，memory skill 使用
├── MEMORY.md         # 可选
├── KNOWLEDGE.md      # 可选，知识库总览或单文件知识（knowledge skill 使用）
├── knowledge/        # 可选，按主题的知识库目录（knowledge skill 使用）
│   ├── faq.md        # 单文件主题
│   ├── <topic>/      # 主题目录，其下为知识点 .md
│   └── index.sqlite  # 可选 FTS5 全文索引（Node 22+，由 knowledge_sync 创建）
├── cron/
│   └── jobs.json     # 定时任务（cron skill / CronStore 使用）
└── (其它技能或配置)
```

- **SOUL.md**：原则、边界、气质、延续性；每轮会话会注入到 system prompt。
- **IDENTITY.md**：名字、类型、可对外展示的档案；可随使用演进。
- **skills/**：每个技能为一子目录，内含 SKILL.md、scripts/、references/ 等；可增删改。
- **memory/**、**MEMORY.md**：长期记忆，由 memory 类技能使用；可积累、可导出。
- **KNOWLEDGE.md**、**knowledge/**：知识库，由 knowledge 技能使用；检索、自学习、按主题/知识点组织；详见下文「知识库（knowledge 模块）」。
- **cron/jobs.json**：定时任务列表；由 @monou/cron 的 CronStore 读写，Gateway 提供 cron.* RPC。任务可带 **deliver**（见下文「定时任务汇报」）。

**定时任务汇报**：当任务 `payload.kind` 为 `agentTurn` 时，可配置 `deliver: { connectorId, chatId }`。到点执行完成后，由连在 Gateway 上的 Agent 进程通过 `connector.message.push` 将本轮结果文本推到指定 Connector 的该会话（如飞书群）。获取飞书 chatId：在该飞书群内与机器人对话时，会话的 sessionKey 通常含对应 chat 信息；或从 feishu-app 日志、Control UI 会话列表中查看当前会话对应的 chatId（如 `oc_xxx` 形式）。不配置 deliver 时任务仍会执行，只是不会自动推送到任何会话。

**会话**：不放在 agent 目录。由控制面（Gateway）管理：元数据在 `.gateway/sessions/sessions.json`，transcript 在 `.gateway/sessions/transcripts/`。未指定 sessionKey 时按时间新建。agent 目录不包含 chat.json；若目录内仍有遗留的 chat.json，可删除。

## 二、技能目录约定（skills/<name>/）

每个技能为一子目录，至少包含：

- **SKILL.md**：技能说明与指引，可选 YAML frontmatter（name、description、disable-model-invocation 等）；由 @monou/skills 加载并格式化为 system prompt 片段。
- **scripts/**：可选，脚本或工具实现；可由 agent-sdk / agent-from-dir 的 loadSkillScriptTools、createSkillScriptExecutor 加载为 Agent 工具。
- **references/**：可选，参考资料。

必备技能名（与 @monou/agent-template 的 U_BASE_SKILL_NAMES 一致）：base_skill、skill-creator、memory、knowledge、cron、web_skill、browser_skill、message_skill、sessions_skill、gateway_skill 等。使用 `ensureAgentDir()` 时会从包内模板补齐缺失项。

## 三、知识库（knowledge 模块）

knowledge 是内置技能之一，提供工作区知识库的**检索、自学习与知识转 Skill**。与 memory 区分：**memory** 用于对话记忆、「之前说过」；**knowledge** 用于文档/知识库/FAQ、「根据文档/如何配置」类问题。

**存储约定**（均在 agent 根目录下）：

| 路径 | 说明 |
|------|------|
| `KNOWLEDGE.md` | 总览或单文件知识库；可含 `## Add` 区块供 knowledge_add / knowledge_learn 追加。 |
| `knowledge/*.md` | 按主题的单文件，如 `knowledge/faq.md`。 |
| `knowledge/<topic>/` | 主题目录，topic 为文件夹名（如 股票、高中数学）；其下为**知识点** .md（如 `knowledge/股票/K线.md`）。 |
| `knowledge/<topic>/learned.md` | knowledge_learn 仅指定 topic 时的默认追加文件。 |
| `knowledge/index.sqlite` | 可选 FTS5 全文索引（Node 22+），由 knowledge_sync 创建；可提升 knowledge_search 速度。 |

**主要工具**（由 skills/knowledge/scripts/tools.ts 提供，agent-from-dir 自动加载）：

- **knowledge_search**：在 KNOWLEDGE.md、knowledge/*.md 中按关键词或 topic 检索；有 FTS5 索引时优先全文检索。
- **knowledge_get**：按 path 与行范围读取知识库片段（仅允许上述路径）。
- **knowledge_add**：将一条知识追加到 KNOWLEDGE.md 的 ## Add 或指定 knowledge/<topic>.md。
- **knowledge_learn**：自学习，按 topic/知识点写入 knowledge/<topic>/<point>.md 或 learned.md。
- **knowledge_learn_from_urls**：从 URL 抓取内容后写入知识库。
- **knowledge_list_topics** / **knowledge_list_points(topic)**：列出主题与某主题下知识点。
- **knowledge_sync**：重建 FTS5 索引（Node 22+）；大量修改知识库后调用。
- **knowledge_skill_create(topic, description)**：将某主题知识转为独立 Skill（生成 `<topic>_knowledge` 目录及 `<topic>_knowledge_search` 工具）。

工作区默认 agent 根目录（.u）；可通过环境变量 `KNOWLEDGE_WORKSPACE`、`KNOWLEDGE_INDEX_PATH`、`KNOWLEDGE_EMBEDDING_ENABLED` 等覆盖。

## 四、模板与路径（@monou/agent-template）

- **getAgentDir(rootDir)**：默认返回 `path.join(rootDir, ".u")`。
- **ensureAgentDir(options)**：若目录不存在则从包内 template 复制；可选 `rootDir`、`agentDir`、`forceSync`；已存在且未 forceSync 时只补齐模板里有而目录里没有的项。
- **getAgentSkillDirs(rootOrAgentDir, opts)**：返回必备技能目录的绝对路径列表。

本机默认 agent 目录通常为工作区下的 `.u`；多 agent 时可为 `agents/<id>/` 或任意同构目录，通过 AGENT_DIR 指定。

## 五、与运行时的关系

- **加载**：apps/agent、TUI、Gateway（只读如 skills.status）等通过 @monou/agent-from-dir 的 `buildSessionFromU`、`createAgentContextFromU` 从该目录构建 session 与 context。
- **迭代**：用户或 Agent（通过 skill-creator）在 skills/ 下增删改；SOUL/IDENTITY 可编辑；下次加载即生效，无需发版。
- **标准化**：凡符合上述约定的目录即为「monoU 兼容智能体」；可版本管理（git）、复制、打包、迁移；不锁平台、不锁厂商。

## 六、多 Agent 与多目录

- 同一 Gateway 可连接多个 agent 进程，每个进程指定不同 **AGENT_ID** 与 **AGENT_DIR**（每个目录与 .u 同构）。
- 在 Control UI 或 RPC 中可选择不同 agentId/nodeId 进行对话或派发；cron 与 session 按 agent/device 与 sessionKey 管理。
