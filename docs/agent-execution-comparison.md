# pi-coding-agent（pi-agent-core）与 monoU：形态接口与逻辑对齐、超越

> monoU 侧 Agent 运行机制（执行循环、入口、代码位置）的整合说明见 [agent-running.md](./agent-running.md)。

本文档对照 **pi-agent-core**（`pi-mono/packages/agent`）与 **monoU**（`packages/agent-core` + `packages/agent-sdk`）的**形态接口**与**执行逻辑**，并说明 monoU 已做的对齐与超越点。

---

## 一、形态接口对齐（与 pi 一致）

| 配置/能力 | pi-agent-core | monoU（已实现） |
|-----------|----------------|------------------|
| **convertToLlm** | `(messages: AgentMessage[]) => Message[] \| Promise<Message[]>` | `AgentLoopConfig.convertToLlm`，同语义 |
| **transformContext** | `(messages, signal?) => Promise<AgentMessage[]>`，在每次 LLM 前做裁剪/注入 | `AgentLoopConfig.transformContext`，在 `runOneTurnStreaming` 内、`convertToLlm` 前调用 |
| **getSteeringMessages** | `() => Promise<AgentMessage[]>`，每轮初或每次工具后注入，剩余 tool 可 skip | `AgentLoopConfig.getSteeringMessages`，每轮初调用；每次工具执行后调用，若有则对剩余 call 写 skip 并注入 |
| **getFollowUpMessages** | `() => Promise<AgentMessage[]>`，无 toolCalls 时若返回则继续循环 | `AgentLoopConfig.getFollowUpMessages`，无 toolCalls 时调用，若有则 `appendMessage` 后继续 |
| **append 任意消息** | context.messages.push(msg) | `appendMessage(state, message)`（agent-core/state.ts），供 steering/follow-up 使用 |

以上均在 **agent-core 的 AgentLoopConfig / state** 与 **agent-sdk 的 runAgentTurnWithToolsStreaming** 中实现，与 pi 的语义一致。

---

## 二、核心循环（一致）

两边都是同一种「**多轮工具循环**」：

1. **追加用户消息**
2. **循环**：
   - 调用 LLM（流式）→ 得到 **文本 + 若干 tool_calls**
   - 若 **无 tool_calls** → 结束，返回
   - 若有 **tool_calls** → 逐个执行工具，将结果按 **toolCallId** 写回会话（toolResult）
   - 用更新后的 messages 再调 LLM，重复直到无 tool_calls 或达到上限
3. **返回**：最终助手文本 + 已执行的 toolCalls（结果已在 messages 中）

---

## 二、pi-agent-core 实现（pi-mono/packages/agent）

- **入口**：`Agent.prompt(input)` → `_runLoop(msgs)` → `agentLoop(prompts, context, config, signal, streamFn)`（`src/agent.ts`）
- **主循环**：`src/agent-loop.ts` 的 `runLoop()`：
  - **外层** `while (true)`：处理 follow-up 消息（`getFollowUpMessages`），无则 `break`
  - **内层** `while (hasMoreToolCalls || pendingMessages.length > 0)`：
    1. 若有 pending（steering）消息则先注入 `currentContext.messages`
    2. **一次 LLM 调用**：`streamAssistantResponse(currentContext, config, signal, stream, streamFn)`  
       - 内部：`convertToLlm(messages)` → `streamFn(model, llmContext, opts)`（pi-ai 的 `streamSimple` 签名）  
       - 消费流，得到 `AssistantMessage`（`content` 含 `text` 与 `type: "toolCall"` 的块）
    3. `toolCalls = message.content.filter(c => c.type === "toolCall")`，`hasMoreToolCalls = toolCalls.length > 0`
    4. 若有 toolCalls：`executeToolCalls(tools, message, ...)`  
       - 对每个 toolCall：`tool = tools.find(t => t.name === toolCall.name)`，`result = await tool.execute(id, args, ...)`  
       - 构造 `ToolResultMessage`（role: "toolResult", toolCallId, content, isError）并 push 到 `currentContext.messages`
    5. 无 toolCalls 时退出内层；再查 `getFollowUpMessages()` 决定是否继续外层
- **工具执行**：`executeToolCalls()`（同文件）中按顺序执行，支持 `getSteeringMessages` 中途插入用户消息（剩余 tool 可被 skip）

---

## 三、monoU 实现（packages/agent-core + agent-sdk）

- **入口**：`runAgentTurnWithTools(state, config, streamFn, userInput, executeTool, signal)`（`packages/agent-sdk/src/agent.ts`）
- **主循环**：`runAgentTurnWithToolsStreaming()`（与 pi runLoop 逻辑对齐）：
  1. `currentState = appendUserMessage(state, userInput)`
  2. **循环** `while (rounds < maxToolRounds)`（默认 5）：
     - **Steering（轮初）**：若配置了 `getSteeringMessages`，调用并将返回的每条消息 `appendMessage` 到 `currentState`
     - **一次 LLM 调用**：`runOneTurnStreaming(currentState, config, streamFn, signal, onTextChunk)`（`packages/agent-core/src/loop.ts`）  
       - 若配置了 `transformContext`，先对 `state.messages` 做变换，再 `convertToLlm` → `streamFn(...)`
       - 消费流，收集 text 与 toolCalls，`appendAssistantMessage` 得到新 state
     - 若 **无 toolCalls**：调用 `getFollowUpMessages`；若无 follow-up 则返回，若有则对每条 `appendMessage` 后 `continue`
     - 若有 **toolCalls**：逐个 `executeTool` → `appendToolResult`；**每次工具后**调用 `getSteeringMessages`，若有则对剩余 call 写 skip 结果并注入 steering 消息，然后 `break` 出工具循环、进入下一轮
     - `currentState = stateWithResults`，`rounds++`，继续下一轮
- **工具执行**：由调用方传入的 `executeTool(name, args)`（如 agent-from-dir 的 `session.executeTool`）返回 `{ content, isError? }`，SDK 用 `appendToolResult` 写回 state

---

## 四、逐项对照

| 项目 | pi-agent-core（pi-mono/packages/agent） | monoU（agent-core + agent-sdk） |
|------|----------------------------------------|----------------------------------|
| **单次 LLM 调用** | `streamAssistantResponse`：`convertToLlm` → `streamFn(model, llmContext, opts)`，流式得到 AssistantMessage（content 含 text + toolCall blocks） | `runOneTurnStreaming`：`convertToLlm` → `streamFn(messages, tools, signal)`，流式得到 text + toolCalls 数组 |
| **streamFn 签名** | `(model, llmContext, options)`，llmContext = { systemPrompt, messages, tools }（pi-ai） | `(messages, tools, signal)`，system 通常在 messages 的首条 system 消息中 |
| **是否有 tool_calls** | `message.content.filter(c => c.type === "toolCall")`，`hasMoreToolCalls = toolCalls.length > 0` | `result.toolCalls.length === 0` 则返回 |
| **执行工具** | `executeToolCalls`：对每个 toolCall 找 `tools.find(t => t.name === toolCall.name)`，`tool.execute(id, args, ...)`，结果 push 为 role: "toolResult" 的 message | for 每 call：`executeTool(call.name, args)` → `appendToolResult(state, call.id, out.content, out.isError)` |
| **下一轮** | 同一 `runLoop` 内层继续：`currentContext.messages` 已含 toolResult，再次 `streamAssistantResponse` | `currentState = stateWithResults`，下一轮 `runOneTurnStreaming(currentState, ...)` |
| **循环上限** | 无显式 maxRounds（内层由「无 toolCalls + 无 pending」退出；外层由「无 followUp」退出） | 与 pi 一致：不设则无上限；可选 `maxToolRounds` 显式限制 |
| **convertToLlm** | 过滤为 LLM 可用的 Message[]（user / assistant / toolResult） | 过滤为 user / assistant / system / toolResult（见 agent-sdk defaultConvertToLlm） |
| **steering / follow-up** | 有：`getSteeringMessages`、`getFollowUpMessages` | **已对齐**：`AgentLoopConfig.getSteeringMessages` / `getFollowUpMessages`，轮初 + 每次工具后 steering，无 toolCalls 时 follow-up |

---

## 五、结论与超越

### 形态与逻辑

- **形态接口**：monoU 的 `AgentLoopConfig` 已与 pi 对齐（`transformContext`、`getSteeringMessages`、`getFollowUpMessages`），并提供 `appendMessage` 用于注入任意消息。
- **核心执行逻辑**：与 pi 的 runLoop 一致——追加用户消息 → 循环（LLM → tool_calls → 执行并写回 toolResult → 支持 steering/follow-up）→ 返回。monoU 在 `runAgentTurnWithToolsStreaming` 中实现了轮初 steering、每次工具后 steering（含剩余 skip）、无 toolCalls 时 follow-up 继续。
- **streamFn 签名**：monoU 仍为 `(messages, tools, signal)`（system 在首条 system message），与 pi 的 `(model, llmContext, opts)` 形态不同但语义等价；若需对接 pi-ai 的 `streamSimple`，可在调用侧包一层 adapter。

### monoU 的超越点

| 维度 | 说明 |
|------|------|
| **可选 maxToolRounds** | 与 pi 一致默认无上限；需要时可通过 `maxToolRounds` 显式限制工具轮数。 |
| **定义即文件（L4）** | Agent 目录（SOUL、IDENTITY、skills、cron）即真相来源，可版本化、迁移、不锁运行时；pi 侧重单进程 session。 |
| **编排与执行分离** | Gateway 只做路由/会话/Cron RPC，执行在 Agent 进程或独立 daemon；Cron 存储可在 agent 目录，与 heartbeat 统一。 |
| **transformContext + compaction** | `transformContext` 可接入 `maybeCompactState`（agent-from-dir）：在长会话下先压缩再跑 turn，与 pi 的 compaction 思路一致且可插在现有 config 上。 |
| **多 Connector、多 Agent** | Gateway 支持多 Connector 映射、多 Agent/Node，heartbeat 与 `agent.heartbeat` 上报「最近活跃」，便于扩展与可观测。 |

综上：**形态接口与执行逻辑已与 pi 对齐**；在配置显式上限、定义即文件、编排分离、compaction 集成与多端扩展上，monoU 实现可视为对 pi 的延续与超越。
