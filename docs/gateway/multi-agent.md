---
title: "Multi-agent: delegation and group chat"
summary: "Delegation to another agent's session; group chat sessions with multiple agents; reply modes and routing."
read_when:
  - Implementing or using agent delegation
  - Designing or using group chat (multi-agent sessions)
---

# Multi-agent: delegation and group chat

This doc covers two behaviors: **(1) Delegation to another agent's session** — the current agent sends a message to a **target session**, and the target agent **replies directly in that session**; **(2) Group chat sessions** — multiple agents (and the user) in one session, with routing and reply modes.

**Terms:** A UI "window" corresponds to a **session**. Whoever replies, that **agent's reply is written into that session's transcript**. The Hub **does not run agents**; all turns are executed by **Agent processes** connected to the Hub. Start each agent separately (e.g. `npm run agent` with different `AGENT_ID`); they connect to the Hub and receive work via chat.send / node.invoke.

---

## 1. Session and UI

- **Unit:** **session** (identified by sessionKey). In Control UI: each **Agent** entry opens that agent's **main session** (`agent:<agentId>:main`); there are also sessions for group chats, connector chats, etc.
- **Current session** = current `(agentId, sessionKey)`. When the user sends a message, that agentId runs; **that agent's reply is appended to that session's transcript**. Opening that session shows the reply.
- **Delegation:** Send to a **target session** (e.g. B's main); **B replies in that session**; the reply is stored in that session's transcript, not in A's.

---

## 2. Delegation to another agent's session

### 2.1 Semantics

- User sends a message in **A's session**; A decides "B should handle this."
- A calls a tool that **sends a message to the target session** (e.g. B's main `agent:B:main`). **B runs one turn in that session** and the reply is written to **that session's transcript**.
- User opens that session in the UI to see B's reply. Optionally, the Hub can return B's reply to A so A can show "Forwarded to B; open B's session to see" or a short quote.

### 2.2 Conventions

- **Main session per agent:** `sessionKey = agent:<agentId>:main`. When delegating, if no sessionKey is given, use the target agent's main.
- **Reply location:** B's reply is written **only** to the target session's transcript, not to A's.

### 2.3 Protocol and tool

- **Hub:** Existing `chat.send(agentId, sessionKey, message)`. Delegation = call with target agentId and sessionKey (e.g. `agent:B:main`); B runs one turn there; no new RPC.
- **Agent tool (gateway_skill):** e.g. **gateway_agent_send_to_session** (or **agent_delegate**). Params: `targetAgentId` (required), `message` (required), optional `sessionKey` (default `agent:<targetAgentId>:main`). Implementation: `gatewayInvoke("chat.send", { agentId: targetAgentId, sessionKey, message })`. Return value can include B's reply so A can summarize or quote.

### 2.4 Who does what

- **Delegation = direct conversation:** A sends to B's session; B replies there. A does **not** manage B's cron or tools.
- **Cron and tools:** If the user (or A) says "report every day at 9am", **B** uses **B's cron skill** (cron_add, etc.) in B's reply to add the job. B's cron skill writes to B's `cron/jobs.json`; B's process runs the scheduler. A does not call `cron.add(agentId: B)`.
- **Tools:** When B replies or runs cron, B uses **B's Definition** (skills, knowledge, etc.). So B's directory must have the right skills and B's process must be running.

**Summary:** A only "sends the message to B's session"; B handles cron and tools in that session.

### 2.5 Example flow

1. User in A's session: "Ask the stock agent for today's market and to add a daily 9am report."
2. A calls `gateway_agents_list`, gets B (e.g. stock_learning).
3. A calls `gateway_agent_send_to_session(targetAgentId: "stock_learning", message: "Please report today's market and add a daily 9am report job for yourself.")`.
4. Hub runs `chat.send(agentId: B, sessionKey: agent:B:main, message)`. **B** runs one turn: uses knowledge/cron skills, reply written to B's session transcript.
5. User opens B's session to see B's reply; at 9am B's cron runs in B's context.

---

## 3. Group chat sessions

### 3.1 Goal

- One **session** with **multiple participants**: at least multiple agents + user.
- Same timeline: user message, Agent A reply, Agent B reply (with **senderAgentId** on each assistant message).
- Need: who is in the group, who replies this round, how transcript is stored, routing rules.

### 3.2 Session metadata

- **SessionEntry:** `sessionType: "single" | "group"` (default single). For group: `participantAgentIds: string[]`, `leadAgentId?: string` (default replier when no @).
- **sessionKey:** e.g. `group:<id>` or `agent:.u:group-<id>`; group is identified by SessionEntry.sessionType and participantAgentIds.

### 3.3 Transcript: who said what

- **StoredMessage** (and on-wire): optional **senderAgentId** on assistant messages. When role is assistant, senderAgentId = which agent wrote this reply.
- **chat.history** returns messages with senderAgentId; Control UI shows "User" / ".u" / "stock_learning" etc. per message.

### 3.4 Routing: who replies

| Mode | Description |
|------|-------------|
| **leadAgentId** | Default: one "lead" agent replies when there is no @. |
| **@agentId** | Parse @agentId in message (e.g. "@stock_learning see today's market"); route to that agent if in participantAgentIds. |
| **replyMode "all"** | (Optional.) One user message → each participant runs one turn; multiple assistant messages appended (each with senderAgentId). Control UI: `/all message` or chat.send with replyMode: "all". |
| **replyMode "task"** | (Optional.) One "task" user message → participants take turns (A→B→A→B…) until a completion marker or maxRounds. chat.send with replyMode: "task"; Control UI: `/task task text`. |

Recommended default: **leadAgentId + @agentId** (single replier per message unless @ specified).

### 3.5 Creating a group and adding members

- **Create group:** Control UI "New group chat" → choose sessionKey, call **sessions.patch** (or session.createGroup) with sessionType=group, participantAgentIds, leadAgentId.
- **Add member:** **sessions.patch(sessionKey, { participantAgentIds: [...current, newAgentId] })**. New member gets same transcript history when they reply (full group history as context).
- **Invite in UI:** Control UI can list online agents (from node.list), exclude already-in-group, then sessions.patch to append participantAgentIds.

### 3.6 Hub behavior (group)

- **resolveSession:** For sessionKey, load SessionEntry; if sessionType === "group", use group logic.
- **chat.send (group):** From entry get participantAgentIds, leadAgentId; parse @agentId in message or use leadAgentId; load **same transcript** for that session; run **one** agent this round; append user message + assistant with senderAgentId.
- **chat.history:** Return messages with senderAgentId for assistant role so UI can show who said what.

### 3.7 Control UI for group chat

- Group sessions listed separately (e.g. "Group chats"); open by sessionKey.
- In chat panel, if session is group: show sender for each message (User / agentId). Assistant messages use senderAgentId for label.
- Optional: input or dropdown to choose replier or rely on @ and leadAgentId.

---

## 4. Implementation checklist

### Delegation

| Item | Notes |
|------|--------|
| gateway_skill: **gateway_agent_send_to_session** | targetAgentId, message, optional sessionKey (default agent:\<targetAgentId\>:main); call chat.send; target agent replies in that session. |
| Docs / SKILL.md | State that delegation = direct conversation; cron and tools are done by B in B's session. |

### Group chat

| Item | Notes |
|------|--------|
| SessionEntry: sessionType, participantAgentIds, leadAgentId | session store + sessions.patch. |
| StoredMessage: senderAgentId | Store and return in chat.history. |
| chat.send group branch | Resolve group session, pick agent (lead or @), run one turn, append with senderAgentId. |
| replyMode "all" / "task" | Optional; document in protocol. |
| Control UI: group creation, invite, show senders | New group, sessions.patch, history with senderAgentId. |

---

## 5. Related docs

- [Gateway protocol](./protocol.md)
- [Agent directory](../concepts/agent-directory.md)
- [Agent running](../runtime/agent-running.md)
