# 环境变量

代码中使用的环境变量。以根目录 `env.example` 为模板（复制为 `.env`）；勿提交 `.env`。

## LLM（Agent 回合）

| 变量 | 说明 |
|------|------|
| `OPENAI_API_KEY` | OpenAI API 密钥。 |
| `OPENAI_BASE_URL` | 可选；OpenAI API 默认 base。 |
| `OPENAI_MODEL` | 模型 id（如 gpt-4o-mini）。 |
| `AIHUBMIX_API_KEY` | 替代；OpenAI 兼容（如 AIHubMix）。 |
| `AIHUBMIX_BASE_URL` | Base URL（如 https://aihubmix.com/v1）。 |
| `AIHUBMIX_MODEL` | 模型 id。 |
| `BIANXIE_API_KEY` | 替代 provider；在 agent-from-dir 中优先于 AIHUBMIX/OPENAI。 |
| `BIANXIE_BASE_URL`、`BIANXIE_MODEL` | 可选 base 与 model。 |

`getLlmEnv()` 中的解析顺序（agent-from-dir）：BIANXIE → AIHUBMIX → OPENAI。

## Gateway

| 变量 | 说明 |
|------|------|
| `GATEWAY_PORT` | 端口（默认 9347）。 |
| `GATEWAY_HOST` | 主机（默认 127.0.0.1）。 |
| `GATEWAY_DATA_DIR`、`GATEWAY_STATE_DIR` | 数据目录（默认 `./.gateway`）。 |
| `CRON_STORE` | 覆盖 cron 存储路径（默认在工作区下，如 `.first_paramecium/cron/jobs.json`）。 |
| `GATEWAY_TOKEN`、`GATEWAY_PASSWORD` | 若设置，connect 须带 `token` 或 `password`。 |
| `GATEWAY_TLS_CERT`、`GATEWAY_TLS_KEY` | wss 用 TLS。 |
| `GATEWAY_AGENT_HEARTBEAT_TIMEOUT_MS` | 未收到 agent 心跳则断开（0 表示不启用）。 |

## Agent 应用

| 变量 | 说明 |
|------|------|
| `GATEWAY_URL`、`GATEWAY_WS_URL` | Gateway 的 WebSocket 地址（必填）。 |
| `AGENT_ID` | 智能体 id（必填）。 |
| `AGENT_DIR`、`AGENT_ROOT_DIR` | 智能体目录路径（必填）。 |
| `DEVICE_ID` | 可选；默认 hostname 或 AGENT_ID。 |
| `GATEWAY_TOKEN`、`GATEWAY_PASSWORD` | 与 Gateway 认证一致。 |

Heartbeat 相关见 apps/agent 源码：`HEARTBEAT_ACTIVE_HOURS_START`、`HEARTBEAT_ACTIVE_HOURS_END`、`HEARTBEAT_ACTIVE_HOURS_TZ`，以及 HEARTBEAT.md / HEARTBEAT_OK 逻辑。

## Memory / Knowledge 技能

| 变量 | 说明 |
|------|------|
| `MEMORY_INDEX_PATH` | FTS5 索引路径（默认 `.first_paramecium/memory/index.sqlite`）。 |
| `MEMORY_EMBEDDING_ENABLED` | 设为 1 等启用向量检索。 |
| `MEMORY_INDEX_SESSION`、`MEMORY_SESSION_PATH` | 可选会话转录索引。 |
| `MEMORY_EXTRA_PATHS` | memory 工具允许的额外路径。 |
| `KNOWLEDGE_INDEX_PATH` | FTS5 索引（默认 `.first_paramecium/knowledge/index.sqlite`）。 |
| `KNOWLEDGE_EMBEDDING_ENABLED` | 在 knowledge_sync 中启用向量。 |
| `KNOWLEDGE_EXTRA_PATHS` | knowledge 额外路径。 |
| `KNOWLEDGE_WORKSPACE` | 覆盖知识库文件的工作区根。 |
| `EMBEDDING_API_KEY` | 启用 embedding 时用于向量索引。 |

## Web / 搜索（技能）

| 变量 | 说明 |
|------|------|
| `SERPER_API_KEY`、`TAVILY_API_KEY` | 供技能中 web_search 使用。 |

其他应用专用变量（如 feishu-app）见各应用目录及 env.example。
