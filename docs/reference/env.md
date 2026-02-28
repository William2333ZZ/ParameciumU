# Environment Variables

Variables used by the apps and packages, as found in the codebase. Use root `env.example` as a template (copy to `.env`); do not commit `.env`.

## LLM (Agent turns)

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | OpenAI API key. |
| `OPENAI_BASE_URL` | Optional; default OpenAI API base. |
| `OPENAI_MODEL` | Model id (e.g. gpt-4o-mini). |
| `AIHUBMIX_API_KEY` | Alternative; OpenAI-compatible (e.g. AIHubMix). |
| `AIHUBMIX_BASE_URL` | Base URL (e.g. https://aihubmix.com/v1). |
| `AIHUBMIX_MODEL` | Model id. |
| `BIANXIE_API_KEY` | Alternative provider; takes precedence over AIHUBMIX/OPENAI in agent-from-dir. |
| `BIANXIE_BASE_URL`, `BIANXIE_MODEL` | Optional base and model. |

Resolution order in `getLlmEnv()` (agent-from-dir): BIANXIE → AIHUBMIX → OPENAI.

## Gateway

| Variable | Description |
|----------|-------------|
| `GATEWAY_PORT` | Port (default 9347). |
| `GATEWAY_HOST` | Host (default 127.0.0.1). |
| `GATEWAY_DATA_DIR`, `GATEWAY_STATE_DIR` | Data directory (default `./.gateway`). |
| `CRON_STORE` | Override cron store path (default under workspace, e.g. `.first_paramecium/cron/jobs.json`). |
| `GATEWAY_TOKEN`, `GATEWAY_PASSWORD` | If set, connect must send `token` or `password`. |
| `GATEWAY_TLS_CERT`, `GATEWAY_TLS_KEY` | TLS for wss. |
| `GATEWAY_AGENT_HEARTBEAT_TIMEOUT_MS` | Disconnect agent if no heartbeat (0 = disabled). |

## Agent app

| Variable | Description |
|----------|-------------|
| `GATEWAY_URL`, `GATEWAY_WS_URL` | WebSocket URL of the Gateway (required). |
| `AGENT_ID` | Agent identifier (required). |
| `AGENT_DIR`, `AGENT_ROOT_DIR` | Path to agent directory (required). |
| `DEVICE_ID` | Optional; defaults to hostname or AGENT_ID. |
| `GATEWAY_TOKEN`, `GATEWAY_PASSWORD` | Same as Gateway auth. |

Heartbeat-related (see apps/agent source): `HEARTBEAT_ACTIVE_HOURS_START`, `HEARTBEAT_ACTIVE_HOURS_END`, `HEARTBEAT_ACTIVE_HOURS_TZ`, and logic for HEARTBEAT.md / HEARTBEAT_OK.

## Memory / Knowledge skills

| Variable | Description |
|----------|-------------|
| `MEMORY_INDEX_PATH` | FTS5 index path (default `.first_paramecium/memory/index.sqlite`). |
| `MEMORY_EMBEDDING_ENABLED` | Enable vector search when set (e.g. 1). |
| `MEMORY_INDEX_SESSION`, `MEMORY_SESSION_PATH` | Optional session transcript indexing. |
| `MEMORY_EXTRA_PATHS` | Extra paths allowed for memory tools. |
| `KNOWLEDGE_INDEX_PATH` | FTS5 index (default `.first_paramecium/knowledge/index.sqlite`). |
| `KNOWLEDGE_EMBEDDING_ENABLED` | Enable vector in knowledge_sync. |
| `KNOWLEDGE_EXTRA_PATHS` | Extra paths for knowledge. |
| `KNOWLEDGE_WORKSPACE` | Override workspace root for knowledge files. |
| `EMBEDDING_API_KEY` | For vector indexing when embedding is enabled. |

## Web / Search (skills)

| Variable | Description |
|----------|-------------|
| `SERPER_API_KEY`, `TAVILY_API_KEY` | For web_search when used by skills. |

Other app-specific vars (e.g. feishu-app) are in their respective directories and env.example files.
