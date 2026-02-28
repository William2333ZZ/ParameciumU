# 架构

本文描述 ParameciumU 主要组件如何协同工作，与代码实现一致。

## 概览

- **Gateway**：WebSocket 服务端。处理连接（operator、agent、node、connector）、会话、cron RPC，并将「运行智能体」请求转发给已连接的 Agent 进程。不运行 LLM，不存储智能体人格。
- **Agent 进程**：常驻进程，以 `role: "agent"` 连接 Gateway，通过 `@monou/agent-from-dir` 加载一个智能体目录，在 Gateway 下发任务（如 `node.invoke` 或内部 agent 调用）时执行回合（LLM + 工具）。Cron 任务存储在该智能体目录；Agent 进程运行 cron 调度器并执行到期任务（如 Heartbeat）。
- **智能体目录**：一个文件夹（如 `.first_paramecium`），定义智能体：`IDENTITY.md`、`SOUL.md`、`MEMORY.md`、`KNOWLEDGE.md`、`skills/`、`cron/jobs.json`。运行时由此目录构建会话与上下文；详见 [智能体目录](./agent-directory.md)。

## 数据流

1. **操作者 / UI** 连接 Gateway（如 Control UI 以 `role: "client"` 或 `"operator"`）。
2. 用户发送消息；Gateway 解析会话与目标智能体。若该智能体有已连接进程，Gateway 请求该进程执行一轮（消息 → LLM + 工具 → 回复）。
3. **Agent 进程** 收到请求，加载智能体目录（未缓存时），使用 `@monou/agent-from-dir` 提供的工具（memory、knowledge、cron、code、todo、web、browser 等）调用 `runAgentTurnWithTools`（来自 `@monou/agent-sdk`），并将结果流式回传。
4. **Gateway** 将回复交给客户端并更新会话转录。

Cron：Gateway 暴露 `cron.*` RPC；默认本地智能体的存储在工作区下（如 `.first_paramecium/cron/jobs.json`）。Agent 进程运行 `@monou/cron` 的 `runScheduler`，执行到期任务（如 Heartbeat），并可选择将结果推送到某 connector。

## 组件位置

| 组件 | 路径 | 职责 |
|------|------|------|
| Gateway 应用 | `apps/gateway` | HTTP + WebSocket 服务、handlers、会话存储、connector 映射 |
| Gateway 包 | `packages/gateway` | 协议类型、GATEWAY_METHODS、GATEWAY_EVENTS、客户端辅助 |
| Agent 应用 | `apps/agent` | 连接 Gateway、加载智能体目录、执行回合、cron 调度器 |
| Agent-from-dir | `packages/agent-from-dir` | buildSessionFromU、createAgentContextFromU，从智能体目录加载技能与工具 |
| Agent-template | `packages/agent-template` | 默认智能体目录结构、ensureAgentDir、getAgentDir、getAgentSkillDirs、U_BASE_SKILL_NAMES |
| Agent-core | `packages/agent-core` | 智能体状态、压缩、消息类型 |
| Agent-sdk | `packages/agent-sdk` | runAgentTurnWithTools、createAgent |
| Cron | `packages/cron` | CronStore、任务类型、调度计算、调度器 CLI |
| LLM provider | `packages/llm-provider` | OpenAI 兼容流式 API，供 agent-from-dir 使用 |
| Control UI | `apps/control-ui` | Vite + React；通过 WebSocket 连接 Gateway |

## 构建顺序

根目录 `package.json` 的 build 脚本按依赖顺序编译：shared → agent-core → skills → cron → agent-sdk → agent-template → llm-provider → agent-from-dir → tui → gateway → apps/gateway → apps/agent。其他应用（control-ui、tui-app 等）由各自 workspace 构建。
