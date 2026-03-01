# Knowledge workspace layout

The knowledge corpus is Markdown under the workspace root. Default root: `./.first_paramecium` (or env `KNOWLEDGE_WORKSPACE`).

## Paths (relative to workspace root)

| Path | Purpose |
|------|---------|
| `KNOWLEDGE.md` | Optional overview or single-file corpus. **## Add** is the append target for knowledge_add / knowledge_learn when no topic is given. |
| `knowledge/*.md` | Topic as a single file, e.g. `knowledge/faq.md`. |
| `knowledge/<topic>/` | Topic as a directory (e.g. stock, math). Under it: **points** (.md files or subdirs). |
| `knowledge/<topic>/<point>.md` | Point file, e.g. `knowledge/stock/K-line.md`, `knowledge/stock/tech/patterns.md`. |
| `knowledge/<topic>/learned.md` | Default file when knowledge_learn is called with only topic. |
| `knowledge/index.sqlite` | Optional FTS5 (and optional vector) index, created by knowledge_sync (Node 22+). |

## Search and path allowlist

- **knowledge_search** scans: workspace `KNOWLEDGE.md`, `knowledge.md`; all `.md` under `knowledge/` (recursive); and `KNOWLEDGE_EXTRA_PATHS` (comma-separated). With **topic**, only `knowledge/<topic>.md` and `knowledge/<topic>/**` are searched.
- **knowledge_get** accepts only the above paths; `..` and paths outside the workspace are rejected.

## Writes

- **knowledge_learn(text, topic?, point?, source?)**: topic+point → `knowledge/<topic>/<point>.md`; topic only → `knowledge/<topic>/learned.md`; else KNOWLEDGE.md ## Add.
- **knowledge_learn_from_urls(urls, topic?, point?)**: fetches URLs then writes with the same rules.
- **knowledge_add**: appends to KNOWLEDGE.md ## Add or to a given path (e.g. `knowledge/stock/K-line.md`).
- You can also use **write** / **edit** (base_skill) on these files; they are normal files and can be versioned and reviewed.

## Environment variables

| Variable | Purpose |
|----------|---------|
| `KNOWLEDGE_WORKSPACE` | Workspace root; default `./.first_paramecium` |
| `KNOWLEDGE_INDEX_PATH` | FTS5 index path; default `knowledge/index.sqlite` under workspace |
| `KNOWLEDGE_EXTRA_PATHS` | Comma-separated extra paths (relative or absolute) included in search and path allowlist |
| `KNOWLEDGE_EMBEDDING_ENABLED` | `1` or `true` to write embeddings on knowledge_sync and enable hybrid search |
| `EMBEDDING_API_KEY` | Embedding API key (or `OPENAI_API_KEY` fallback) |
| `EMBEDDING_BASE_URL` | Embedding API base URL |
| `EMBEDDING_MODEL` | Embedding model name |
| `KNOWLEDGE_VECTOR_WEIGHT` | Hybrid search vector weight (0–1), default 0.7 |
| `KNOWLEDGE_TEXT_WEIGHT` | Hybrid search FTS weight (0–1), default 0.3 |
