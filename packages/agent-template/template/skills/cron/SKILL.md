---
name: cron
description: "定时任务管理：列出、创建、更新、删除、立即运行与查看状态。调度类型支持 at（一次性时间）、every（固定间隔）、cron（cron 表达式）。不依赖 openclaw；任务持久化在 .u/cron/jobs.json。"
---

# Cron（定时任务）

管理定时任务：创建、列表、更新、删除、立即运行与查看状态。任务存储在本地 JSON，不依赖任何网关。

## 何时使用

- 用户要求「每天 9 点提醒」「每 30 分钟检查一次」「下周五 18:00 执行」等时，用 **cron_add** 创建任务。
- 查看已有任务用 **cron_list**，查看调度器状态用 **cron_status**。
- 修改或删除任务用 **cron_update**、**cron_remove**。
- 需要立即执行一次时用 **cron_run**（仅更新运行时间与下次运行时间，不执行 agent；实际定时执行需外部调度器或系统 crontab）。

## 调度类型（schedule）

- **at**：一次性，ISO 时间字符串，如 `2026-02-15T09:00:00Z` 或 `2026-02-15`。
- **every**：固定间隔，`everyMs` 毫秒，可选 `anchorMs`。
- **cron**：标准 cron 表达式，如 `0 9 * * *`（每天 9:00），可选 `tz` 时区。

## 工具

### cron_status

返回当前存储路径、任务数、下次唤醒时间（最小 nextRunAtMs）。

### cron_list

列出任务，可选包含已禁用的。参数 `includeDisabled` 为 true 时包含禁用任务。

### cron_add

创建任务。参数：`name`（必填）、`description`（可选）、`schedule`（必填，见上）、`payload`（必填：`{ kind: "systemEvent", text: "..." }` 或 `{ kind: "agentTurn", message: "..." }`）、`enabled`（可选，默认 true）、`deleteAfterRun`（可选，at 任务默认 true）、`deliver`（可选，见下）。

**deliver**（仅对 `payload.kind === "agentTurn"` 有效）：执行完成后将结果推送到指定 Connector 会话。格式 `{ connectorId: string, chatId: string }`，例如 `{ connectorId: "feishu", chatId: "oc_xxxx" }`。需 Agent 连 Gateway 且对应 Connector（如 feishu-app）已连接，汇报才会发出。飞书 chatId 可从该群内与机器人对话时的会话信息或 Control UI / feishu-app 日志中获得。

### cron_update

更新任务。参数：`id`（必填）、`patch`（可选字段：name、description、enabled、schedule、payload、deleteAfterRun、deliver 等）。

### cron_remove

删除任务。参数：`id`（必填）。

### cron_run

立即“运行”一次任务（更新 lastRunAtMs、nextRunAtMs，不执行 agent）。参数：`id`（必填）、`mode`（可选，`force` 或 `due`，默认 `force`）。

### cron_start_scheduler

启动**常驻定时调度器**（后台进程）。调度器会持续运行，按 `.u/cron/jobs.json` 中的任务到点自动更新状态（相当于到点自动执行 cron_run）。用户说「启动定时器」「开定时调度」时可调用。停止方式：关闭启动时所在终端或结束该进程。

也可在项目根执行 `npm run cron:daemon` 直接启动调度器（monorepo 下已配置该脚本）。

## 存储

任务与记忆等持久化数据统一放在**当前项目的 ./.u 目录**下。定时任务文件可由环境变量 `CRON_STORE` 指定，未设置时默认 `./.u/cron/jobs.json`。
