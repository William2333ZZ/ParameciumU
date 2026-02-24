# @monou/cron

Standalone cron/scheduled job store, schedule computation, and **resident scheduler**. No openclaw dependency.

- **Schedule types**: `at` (one-shot ISO time), `every` (interval ms), `cron` (cron expression + optional timezone via croner).
- **Storage**: JSON file at `CRON_STORE` or default `./.u/cron/jobs.json`.
- **API**: `CronStore(storePath)` with `list`, `status`, `add`, `update`, `remove`, `run`. `run()` only advances state (no agent execution).
- **Scheduler**: `runScheduler(storePath, options?)` runs a loop that wakes at most every 60s, runs due jobs (updates state), and optionally calls `onJobDue(job)` for custom execution (e.g. run agent).

### 常驻调度器

- **CLI**：`npx monou-cron` 或 `npm run cron:daemon`（在 monorepo 根）启动常驻进程，按 `.u/cron/jobs.json` 到点执行任务（更新 lastRunAtMs/nextRunAtMs）。
- **从 skill 启动**：cron skill 提供 `cron_start_scheduler` 工具，agent 可应户请求启动后台调度器。
- **自定义执行**：`import { runScheduler } from "@monou/cron/scheduler"` 并传入 `onJobDue(job)` 可在到点时执行 agent 等逻辑。
