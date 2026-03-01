# Memory workspace layout

Memory is stored as Markdown under the workspace root. Default root: `./.u` (or env `MEMORY_WORKSPACE`; in monoU often the agent dir, e.g. `.first_paramecium`).

## Paths (relative to workspace root)

| Path | Purpose |
|------|---------|
| `MEMORY.md` | Long-term memory: decisions, preferences, important facts. **## Store** = memory_store append target; **## Forgotten** = memory_forget append target. |
| `memory/YYYY-MM-DD.md` | Daily log, append-only. e.g. `memory/2025-02-10.md`. |
| `memory/index.sqlite` | Optional FTS5 (+ optional vector table), created by memory_sync (Node 22+). |
| `session/transcript.md` | Virtual path when MEMORY_INDEX_SESSION=1: content comes from MEMORY_SESSION_PATH JSON (e.g. Gateway transcript export). |

## Search and path allowlist

- **memory_search / memory_recall** scan: workspace `MEMORY.md`, `memory.md`; all `.md` under `memory/`; `MEMORY_EXTRA_PATHS`; and, if `MEMORY_INDEX_SESSION=1`, `session/transcript.md` (from session JSON).
- **memory_get** accepts only the above paths; `..` and paths outside the workspace are rejected.

## Writes

- **memory_store**: appends to MEMORY.md ## Store or today’s memory/YYYY-MM-DD.md.
- **memory_forget**: appends to MEMORY.md ## Forgotten (no deletion; for human review).
- You can also use **write** / **edit** (base_skill) on MEMORY.md or memory/*.md; they are normal files and can be versioned and reviewed.

## Environment variables

| Variable | Purpose |
|----------|---------|
| `MEMORY_WORKSPACE` | Workspace root; default `./.u` |
| `MEMORY_INDEX_PATH` | FTS5 index path; default `memory/index.sqlite` under workspace |
| `MEMORY_EXTRA_PATHS` | Comma-separated extra paths (relative or absolute) included in search and path allowlist |
| `MEMORY_EMBEDDING_ENABLED` | `1` or `true` to write embeddings on memory_sync and enable hybrid search |
| `EMBEDDING_API_KEY` | Embedding API key (or `OPENAI_API_KEY` fallback) |
| `EMBEDDING_BASE_URL` | Embedding API base URL; default `https://api.openai.com/v1` |
| `EMBEDDING_MODEL` | Embedding model name; default `text-embedding-3-small` |
| `MEMORY_VECTOR_WEIGHT` | Hybrid search vector weight (0–1), default 0.7 |
| `MEMORY_TEXT_WEIGHT` | Hybrid search FTS weight (0–1), default 0.3 |
| `MEMORY_INDEX_SESSION` | `1` or `true` to include session transcript in index (experimental) |
| `MEMORY_SESSION_PATH` | Path to session JSON (`[{ role, content }]`), e.g. Gateway transcript export |
