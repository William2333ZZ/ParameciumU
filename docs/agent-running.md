# Agent 运行机制

本文档根据当前代码整理 monoU 中 **Agent 定义与目录**、**执行过程** 与 **Heartbeat** 的完整运行机制，供开发与排查参考。与 [architecture.md](./architecture.md)、[gateway.md](./gateway.md) 配合阅读。

---

## 一、Agent 定义与目录（L4）

智能体由**符合约定结构的文件夹**定义，代码通过 `@monou/agent-template` 与 `@monou/agent-from-dir` 加载。

### 1.1 目录结构

任一 Agent 根目录（如 `.u` 或 `agents/sidekick`）约定如下（与 `@monou/agent-template` 的 template 同构）：

```
<agent_root>/
├── SOUL.md           # 原则、边界、气质；每轮注入 system prompt
├── IDENTITY.md       # 身份：名字、类型、可对外展示的档案
├── HEARTBEAT.md      # 可选，周期学习/汇报时可读；空内容时可跳过当次心跳
├── skills/           # 技能目录
│   ├── base_skill/
│   ├── memory/
│   ├── cron/
│   ├── skill-creator/
│   ├── knowledge/
│   ├── web_skill/
│   ├── message_skill/
│   ├── sessions_skill/
│   └── ...           # 其它自建技能
├── memory/           # 可选，memory skill 使用
├── MEMORY.md         # 可选
├── KNOWLEDGE.md      # 可选，知识库总览（knowledge skill）
├── knowledge/        # 可选，按主题知识库（knowledge skill）
├── cron/
│   └── jobs.json     # 定时任务（CronStore 读写）
└── (其它技能或配置)
```

- **路径约定**：`getAgentDir(rootDir)` 默认返回 `path.join(rootDir, ".u")`；多 Agent 时通过环境变量 `AGENT_DIR` 或参数 `agentDir` 指定。
- **必备技能名**：与 `packages/agent-template/src/index.ts` 中 `U_BASE_SKILL_NAMES` 一致：`base_skill`、`skill-creator`、`memory`、`knowledge`、`cron`、`web_skill`、`message_skill`、`sessions_skill`。`ensureAgentDir()` 会从包内 template 补齐缺失项。
- **会话**：不放在 agent 目录；由 Gateway 管理（`.gateway/sessions/sessions.json`、`transcripts/`）。

### 1.2 从目录加载 Session 与 Context

| 步骤 | 代码位置 | 说明 |
|------|----------|------|
| 确保/解析目录 | `@monou/agent-template`: `ensureAgentDir`, `getAgentDir`, `getAgentSkillDirs` | 若目录不存在则从 template 复制；返回 agent 目录与必备技能路径列表 |
| 构建 Session | `@monou/agent-from-dir`: `buildSessionFromU(rootDir, opts?)` | 解析 `agentDir`、发现 `skills/` 下所有带 `SKILL.md` 的子目录，加载各技能 `scripts/tools.ts` 或 `tools.js`，合并为 `mergedTools` 并实现统一 `executeTool(name, args)` |
| 构建 Context | `@monou/agent-from-dir`: `createAgentContextFromU(session, opts?)` | 读 `SOUL.md`、`IDENTITY.md`，组装 system prompt；调用 `createAgent` 得到 `state`、`config`、`streamFn`；可选 `initialMessages`（如从 transcript 加载） |

- **buildSessionFromU** 的 `executeTool` 按工具名路由到 memory、knowledge、cron、web_skill、message_skill、sessions_skill 或各技能脚本的 `executeTool`；若传入 `gatewayInvoke`，则 message_skill、sessions_skill 可调 Gateway RPC。
- **createAgentContextFromU** 使用 `@monou/agent-sdk` 的 `createAgent`，注入 SOUL/IDENTITY、日期时间上下文，以及 `formatSkillsForPrompt(skillDirs)` 生成的技能说明。

---

## 二、Agent 执行过程

一轮用户输入到最终回复的流程：**追加用户消息 → 多轮工具循环（LLM → tool_calls → 执行工具 → 写回 toolResult）→ 返回**。实现分布在 `@monou/agent-core`（状态与单轮 loop）与 `@monou/agent-sdk`（多轮与工具执行）。

### 2.1 调用入口

| 场景 | 入口 | 代码位置 |
|------|------|----------|
| **apps/agent**（独立进程，连 Gateway） | `runOneTurn(message)` | `apps/agent/src/index.ts`：`buildSessionFromU` + `createAgentContextFromU` + `runAgentTurnWithTools(state, config, streamFn, message, session.executeTool)` |
| **Gateway 本机跑一轮**（无远程 agent 时） | `runAgentTurn(rootDir, message, opts)` | `apps/gateway/src/agent-runner.ts`：同上，可选 `transcriptPath`、`onTextChunk`、`gatewayInvoke` |
| **Cron / Heartbeat 到点执行** | 同上 `runOneTurn` 或 `runAgentTurn` | 见第三节 Heartbeat |

### 2.2 主循环：runAgentTurnWithToolsStreaming

逻辑在 `packages/agent-sdk/src/agent.ts` 的 `runAgentTurnWithToolsStreaming`（非流式入口 `runAgentTurnWithTools` 内部也调用它）：

1. **追加用户消息**：`currentState = appendUserMessage(state, userInput)`。
2. **循环**（直到无 toolCalls 且无 follow-up，或达到 `config.maxToolRounds`）：
   - **轮初 Steering**：若配置了 `config.getSteeringMessages`，调用并将返回的每条消息 `appendMessage` 到 `currentState`。
   - **单轮 LLM**：`runOneTurnStreaming(currentState, config, streamFn, signal, onTextChunk)`（见 2.3）。
   - **无 toolCalls**：调用 `config.getFollowUpMessages`；若无 follow-up 则**返回**；若有则对每条 `appendMessage` 后 **continue**（不增加 rounds）。
   - **有 toolCalls**：逐个 `executeTool(call.name, args)` → `appendToolResult(state, call.id, content, isError)`；**每次工具后**若 `getSteeringMessages` 有返回，则对剩余 call 写 skip 结果并注入 steering 消息，然后 **break** 出工具循环，进入下一轮。
   - `currentState = stateWithResults`，`rounds++`，继续下一轮。

### 2.3 单轮 LLM：runOneTurnStreaming

逻辑在 `packages/agent-core/src/loop.ts` 的 `runOneTurnStreaming`：

1. **transformContext**（若配置）：对 `state.messages` 做变换（如压缩长会话）。
2. **convertToLlm**：将消息转为 LLM 可接受的格式（默认过滤为 user/assistant/system/toolResult）。
3. **streamFn(llmMessages, tools, signal)**：消费流，收集 `text` 与 `tool_call` 块。
4. **appendAssistantMessage**：将本轮文本与 toolCalls 写回 state，返回 `{ state, text, toolCalls }`。

工具不在此处执行，由 SDK 主循环中的 `executeTool`（由 buildSessionFromU 提供的统一实现）执行并写回 toolResult。

### 2.4 配置与扩展点

- **AgentLoopConfig**（agent-core）：`convertToLlm`、`transformContext`、`getSteeringMessages`、`getFollowUpMessages`、`tools`、`maxToolRounds`。agent-from-dir 的 `createAgentContextFromU` 使用默认 `convertToLlm`，并可接入 `transformContext`（如 compaction）。
- **streamFn**：由 `createAgentContextFromU` 通过 `@monou/llm-provider` 的 `createStreamFn` 创建，签名 `(messages, tools, signal) => AsyncIterable<StreamChunk>`，system 在首条 system 消息中。

---

## 三、Heartbeat（在线证明与周期学习）

Heartbeat 在代码中有两层含义：**在线证明**（Gateway 侧「最近活跃」）与**周期学习/汇报**（由 Cron 中的定时任务驱动的一轮 agent turn）。

### 3.1 与 Cron 的关系

- **Heartbeat 必须由 Cron 参与**：要么是名为 `Heartbeat` 的 cron 任务，要么与「学习/汇报」任务合一。
- **实现**：Agent 进程连接 Gateway 成功后，在 `apps/agent/src/index.ts` 的 `onFirstMessage`（connect 成功）里：
  1. **ensureHeartbeatJob(cronStorePath)**：若 `cron/jobs.json` 中不存在名为 `Heartbeat` 的任务则创建，默认 `enabled: true`，`schedule: { kind: "every", everyMs: 30 * 60 * 1000 }`（30 分钟），`payload: { kind: "agentTurn", message: DEFAULT_HEARTBEAT_PROMPT }`。
  2. **runScheduler(cronStorePath, { onJobDue, shouldRunJob, log })**：常驻调度器，到点执行到期任务。

### 3.2 调度器与 onJobDue

- **runScheduler** 来自 `@monou/cron/scheduler`：循环根据 `CronStore.status().nextWakeAtMs` 等待，到期后 `store.list()` 取 enabled 且 `nextRunAtMs <= now` 的任务，对每个执行 `store.run(job.id, "due")`，若 `shouldRunJob(job, now)` 为 true 则调用 `onJobDue(job)`。
- **apps/agent** 的 `onJobDue`：
  - 仅处理 `job.payload.kind === "agentTurn"`。
  - 若 `job.name === "Heartbeat"`：先读 `HEARTBEAT.md`，若内容“有效为空”（仅标题/空列表项）则**跳过当次执行**（不跑 agent、不上报 heartbeat）。
  - 设置 `MEMORY_WORKSPACE`、`CRON_STORE` 后调用 **runOneTurn(message)**。
  - 若是 Heartbeat：对模型回复做 **stripHeartbeatOk**（首尾剥离 `HEARTBEAT_OK`，若剥离后内容 ≤ 300 字则视为无事，不下发）。
  - 若 `job.deliver?.connectorId` 与 `job.deliver?.chatId` 存在且 text 非空，则 **connector.message.push** 推送。
  - 若是 Heartbeat，再调用 **request(ws, "agent.heartbeat", {})** 上报。

### 3.3 在线证明与 lastHeartbeatAt

- **WebSocket 连接存在**即视为该 agent 在线。
- Agent 执行完 Heartbeat 任务后调用 Gateway 的 **agent.heartbeat** RPC；Gateway 在 `handlers.ts` 中更新对应连接的 **lastHeartbeatAt = Date.now()**。
- **agents.list** 返回中带 `lastHeartbeatAt`，供 Control UI 等显示「最近活跃」。

### 3.4 活动时段（可选）

- **shouldRunJob**：`job.name === "Heartbeat"` 时，仅当 `isWithinActiveHours(nowMs)` 为 true 才执行；否则仍推进 schedule，但不调用 onJobDue。
- **isWithinActiveHours**：由环境变量 `HEARTBEAT_ACTIVE_HOURS_START`、`HEARTBEAT_ACTIVE_HOURS_END`（HH:MM 24h）、`HEARTBEAT_ACTIVE_HOURS_TZ`（IANA 或 "local"）控制；未配置则始终在时段内。

### 3.5 小结

| 项目 | 说明 |
|------|------|
| 任务定义 | `cron/jobs.json`，Heartbeat 由 ensureHeartbeatJob 自动创建，默认 30 分钟、enabled: true |
| 执行主体 | Agent 进程内 runScheduler + onJobDue，到点 runOneTurn |
| 默认语义 | 学习/汇报（读 HEARTBEAT.md），无事则 HEARTBEAT_OK、不上报推送 |
| 在线证明 | WebSocket 在线 + agent.heartbeat 上报 lastHeartbeatAt |

---

## 四、端到端数据流简图

```
[Connector / Control UI / 飞书]
         │
         ▼ chat.send / node.invoke.request
┌─────────────────────────────────────────────────────────────┐
│  Gateway（L2）                                                │
│  路由 session/agentId → 已连接 agent 的 connId 或本机 runAgent  │
└─────────────────────────────────────────────────────────────┘
         │
         ├── 远程 Agent 进程 ──► node.invoke.request (message)
         │                              │
         │                              ▼
         │                    buildSessionFromU(agentDir) + createAgentContextFromU
         │                    runAgentTurnWithTools(state, config, streamFn, message, executeTool)
         │                              │
         │                              ▼ node.invoke.result
         │
         └── 本机 runAgent ──► agent-runner.runAgentTurn(rootDir, message, { transcriptPath, ... })
                                     │
                                     ▼ 同上 buildSession + createAgentContext + runAgentTurnWithTools
                                     ▼ 可选写 transcript、onTextChunk 流式回传
```

**Cron/Heartbeat**：Agent 进程内 runScheduler 到点 → onJobDue → runOneTurn(message) → 可选 deliver 推送 → Heartbeat 时 request(ws, "agent.heartbeat")。

---

## 五、相关代码索引

| 主题 | 包/应用 | 文件与符号 |
|------|---------|-------------|
| 目录与模板 | @monou/agent-template | `index.ts`: getAgentDir, ensureAgentDir, getAgentSkillDirs, U_BASE_SKILL_NAMES |
| Session 构建 | @monou/agent-from-dir | `build-session.ts`: buildSessionFromU, createAgentContextFromU, readSoulAndIdentity |
| 状态与单轮 | @monou/agent-core | `state.ts`: appendUserMessage, appendMessage, appendToolResult, appendAssistantMessage；`loop.ts`: runOneTurnStreaming, StreamFn |
| 多轮与工具 | @monou/agent-sdk | `agent.ts`: createAgent, runAgentTurnWithTools, runAgentTurnWithToolsStreaming |
| Agent 进程 | apps/agent | `index.ts`: runOneTurn, ensureHeartbeatJob, runScheduler, onJobDue, agent.heartbeat, stripHeartbeatOk, isHeartbeatContentEffectivelyEmpty, isWithinActiveHours |
| Gateway 本机跑轮 | apps/gateway | `agent-runner.ts`: runAgentTurn（buildSessionFromU + createAgentContextFromU + runAgentTurnWithTools/Streaming）；`handlers.ts`: agent.heartbeat |
| Cron 调度 | @monou/cron | `scheduler.ts`: runScheduler, onJobDue, shouldRunJob；CronStore 读写 jobs.json |

以上内容与当前仓库代码一致；若实现有变更，请以代码为准并同步更新本文档。
