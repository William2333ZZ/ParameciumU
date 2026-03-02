---
title: "Agent running"
summary: "How the agent dir is loaded, runTurn loop, heartbeat and cron, code-level flow."
read_when:
  - Developing or debugging agent execution, tool calls, heartbeat
  - Understanding buildSessionFromU, runOneTurn, runScheduler
---

# Agent running

This doc describes how ParameciumU **loads the agent directory**, runs **one turn** (LLM + tools), and how **heartbeat** and **cron** are wired. It matches the current code. Read with [architecture.md](../concepts/architecture.md) and [gateway/protocol.md](../gateway/protocol.md).

---

## 1. Agent definition and directory (L4)

The agent is defined by a **folder** that follows the [agent-directory](../concepts/agent-directory.md) layout. Loading uses `@monou/agent-template` and `@monou/agent-from-dir`.

### 1.1 Directory layout

Same as in [agent-directory](../concepts/agent-directory.md): SOUL.md, IDENTITY.md, HEARTBEAT.md (optional), skills/, memory/, MEMORY.md, KNOWLEDGE.md, knowledge/, cron/jobs.json. **Sessions** are not in the agent dir; Gateway stores them (e.g. .gateway/sessions/).

### 1.2 Session and context from dir

| Step | Where | What |
|------|--------|------|
| Resolve / ensure dir | @monou/agent-template: ensureAgentDir, getAgentDir, getAgentSkillDirs | Copy from template if missing; return agent dir and skill dirs |
| Build session | @monou/agent-from-dir: buildSessionFromU(rootDir, opts?) | Resolve agentDir, find all skills with SKILL.md, load scripts/tools.ts (or .js), merge into mergedTools and single executeTool(name, args) |
| Build context | @monou/agent-from-dir: createAgentContextFromU(session, opts?) | Read SOUL.md, IDENTITY.md, build system prompt; createAgent → state, config, streamFn; optional initialMessages (e.g. from transcript) |

- **executeTool** routes by tool name to each skill’s executeTool (memory, knowledge, cron, web_skill, gateway_skill, code_skill, todo_skill, etc.). When **gatewayInvoke** is provided, gateway_skill can call Gateway RPC (agents.list, node.list, node.invoke, sessions_*, send_message, etc.). Browser and sandbox are used via **gateway_node_invoke** to L3 nodes, not via a separate browser_skill.
- **createAgentContextFromU** uses @monou/agent-sdk createAgent and injects SOUL/IDENTITY, date/time, and skill descriptions from formatSkillsForPrompt(skillDirs). **LLM** 从 agent 目录的 `llm.json` 读取（loadLlmConfig(agentDir)）：apiKey、baseURL、model；缺项用环境变量 OPENAI_* 补全。

**Default skill set** (from agent-template U_BASE_SKILL_NAMES): base_skill, code_skill, todo_skill, skill-creator, agent-creator, node-creator, memory, knowledge, cron, web_skill, gateway_skill. gateway_skill provides topology, skills/cron queries, agent delegation, **gateway_node_invoke** (node.invoke), sessions, and message push.

---

## 2. Execution flow (one turn)

One user message to one final reply: **append user message → loop (LLM → tool_calls → executeTool → append toolResult) → return**. Implemented in @monou/agent-core (state, single-turn loop) and @monou/agent-sdk (multi-round and tool execution).

### 2.1 Entry points

| Scenario | Entry | Where |
|----------|--------|--------|
| **apps/agent** (process connected to Gateway) | runOneTurn(message) | apps/agent/src/index.ts: buildSessionFromU + createAgentContextFromU + runAgentTurnWithTools(state, config, streamFn, message, session.executeTool) |
| **Gateway local run** (no remote agent) | runAgentTurn(rootDir, message, opts) | apps/gateway/src/agent-runner.ts: same, plus optional transcriptPath, onTextChunk, gatewayInvoke |
| **Cron / Heartbeat** | Same runOneTurn / runAgentTurn | Section 3 |

### 2.2 Main loop: runAgentTurnWithToolsStreaming

In packages/agent-sdk/src/agent.ts:

1. **Append user message:** currentState = appendUserMessage(state, userInput).
2. **Loop** until no toolCalls and no follow-up, or maxToolRounds:
   - **Steering (optional):** If config.getSteeringMessages, append returned messages.
   - **One LLM turn:** runOneTurnStreaming(currentState, config, streamFn, signal, onTextChunk).
   - **No toolCalls:** Call config.getFollowUpMessages; if none, **return**; else append and **continue**.
   - **Has toolCalls:** For each call, executeTool(call.name, args) → appendToolResult(state, call.id, content, isError). After each tool, if getSteeringMessages returns, optionally skip remaining calls and inject steering, then **break** and start next round.
   - currentState = stateWithResults, rounds++, repeat.

### 2.3 Single LLM turn: runOneTurnStreaming

In packages/agent-core/src/loop.ts:

1. **transformContext** (if set): e.g. compact long history.
2. **convertToLlm:** Convert state.messages to LLM format (user/assistant/system/toolResult).
3. **streamFn(llmMessages, tools, signal):** Consume stream; collect text and tool_call chunks.
4. **appendAssistantMessage:** Write text and toolCalls to state; return { state, text, toolCalls }.

Tools are run in the SDK loop by executeTool (from buildSessionFromU), not inside the core loop.

### 2.4 Config and extension

- **AgentLoopConfig** (agent-core): convertToLlm, transformContext, getSteeringMessages, getFollowUpMessages, tools, maxToolRounds. createAgentContextFromU uses default convertToLlm and can plug transformContext (e.g. compaction).
- **streamFn:** Created by createAgentContextFromU via @monou/llm-provider createStreamFn（仅 OpenAI 兼容接口）；配置来自 agent 目录 llm.json；signature (messages, tools, signal) => AsyncIterable&lt;StreamChunk&gt;; system in first system message.

---

## 3. Heartbeat (online proof and periodic run)

Heartbeat has two aspects: **online proof** (Gateway “last active”) and **periodic run** (cron-driven agent turn).

### 3.1 Relation to cron

- Heartbeat is implemented as a **cron job** (e.g. name "Heartbeat").
- On connect success, apps/agent in **onFirstMessage**:
  1. **ensureHeartbeatJob(cronStorePath):** If no job named "Heartbeat", create one (e.g. every 30 min, payload agentTurn with DEFAULT_HEARTBEAT_PROMPT).
  2. **runScheduler(cronStorePath, { onJobDue, shouldRunJob, log }):** Loop; when due, run jobs.

### 3.2 Scheduler and onJobDue

- **runScheduler** (@monou/cron/scheduler): Waits by nextWakeAtMs; then list enabled jobs with nextRunAtMs ≤ now; for each, store.run(job.id, "due"); if shouldRunJob(job, now), call onJobDue(job).
- **apps/agent onJobDue:**
  - Only handles **payload.kind === "agentTurn"**.
  - If **job.name === "Heartbeat"**: read HEARTBEAT.md; if “effectively empty”, **skip** (no runTurn, no heartbeat report).
  - Set MEMORY_WORKSPACE, CRON_STORE; call **runOneTurn(message)**.
  - If Heartbeat: **stripHeartbeatOk** on reply; if short, treat as “nothing to report”, don’t push.
  - If job.deliver?.connectorId and chatId and non-empty text: **connector.message.push**.
  - If Heartbeat: call **request(ws, "agent.heartbeat", {})**.

### 3.3 Online proof and lastHeartbeatAt

- The WebSocket connection being up means the agent is “online”.
- After the Heartbeat run, the agent calls Gateway **agent.heartbeat**; Gateway updates that connection’s **lastHeartbeatAt = Date.now()**.
- **agents.list** includes lastHeartbeatAt for UI (“last active”).

### 3.4 Active hours (optional)

- **shouldRunJob:** For Heartbeat, only run if isWithinActiveHours(nowMs).
- **isWithinActiveHours:** Env HEARTBEAT_ACTIVE_HOURS_START, HEARTBEAT_ACTIVE_HOURS_END (HH:MM 24h), HEARTBEAT_ACTIVE_HOURS_TZ; unset ⇒ always active.

### 3.5 Summary

| Item | Description |
|------|-------------|
| Job | cron/jobs.json; Heartbeat created by ensureHeartbeatJob; default 30 min, enabled |
| Who runs it | Agent process runScheduler + onJobDue → runOneTurn |
| Default meaning | Learn/report (read HEARTBEAT.md); if nothing, HEARTBEAT_OK, no push |
| Online proof | WebSocket + agent.heartbeat → lastHeartbeatAt |

---

## 4. End-to-end flow

```
[Control UI / Feishu / TUI]
         │
         ▼ chat.send / node.invoke
┌─────────────────────────────────────────────────────────────┐
│  Gateway (L2)                                                │
│  Route session/agentId → connected agent connId or local run │
└─────────────────────────────────────────────────────────────┘
         │
         ├── Remote agent process → node.invoke.request(message)
         │       → buildSessionFromU + createAgentContextFromU
         │       → runAgentTurnWithTools(..., message, executeTool)
         │       → node.invoke.result
         │
         └── Local runAgent → agent-runner.runAgentTurn(rootDir, message, opts)
                 → same buildSession + createAgentContext + runAgentTurnWithTools
                 → optional transcript, onTextChunk
```

**Cron/Heartbeat:** Agent process runScheduler → onJobDue → runOneTurn(message) → optional deliver push → if Heartbeat, request(ws, "agent.heartbeat").

---

## 5. Code index

| Topic | Package / app | Symbols |
|-------|----------------|---------|
| Dir and template | @monou/agent-template | getAgentDir, ensureAgentDir, getAgentSkillDirs, U_BASE_SKILL_NAMES |
| Session build | @monou/agent-from-dir | buildSessionFromU, createAgentContextFromU, readSoulAndIdentity |
| State and single turn | @monou/agent-core | appendUserMessage, appendMessage, appendToolResult, appendAssistantMessage; runOneTurnStreaming, StreamFn |
| Multi-round and tools | @monou/agent-sdk | createAgent, runAgentTurnWithTools, runAgentTurnWithToolsStreaming |
| Agent process | apps/agent | runOneTurn, ensureHeartbeatJob, runScheduler, onJobDue, agent.heartbeat, stripHeartbeatOk, isWithinActiveHours |
| Gateway local run | apps/gateway | agent-runner.runAgentTurn; handlers.agent.heartbeat |
| Cron | @monou/cron | runScheduler, onJobDue, shouldRunJob; CronStore, jobs.json |

When the code changes, update this doc to match.

## Next steps

- [Agent directory](../concepts/agent-directory.md)
- [Heartbeat](./heartbeat.md) / [Heartbeat (automation)](../automation/heartbeat.md)
- [Architecture](../concepts/architecture.md)
- [Gateway and agent.heartbeat](../gateway/protocol.md)
- [Getting started](../start/getting-started.md)
