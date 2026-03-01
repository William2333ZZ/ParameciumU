---
title: "Control UI design"
summary: "Entry flow, information architecture, and interaction for the Control UI client."
read_when:
  - Developing or redesigning Control UI
  - Understanding messages, agent directory, and node capabilities data flow
---

# Control UI design

This doc defines the entry flow, information architecture, and interaction for ParameciumU Control UI. It aligns with [architecture](../concepts/architecture.md) and [Gateway protocol](../gateway/protocol.md). Control UI is a **Client**: it connects to the **Hub** (Gateway) as operator; it does not run agents or nodes.

---

## 1. Goals and principles

- **Role:** Client (Web). Connects to the Hub; unified console for the operator.
- **Core tasks:** Chat with agents, view topology and sessions, manage Cron, manage connections and settings.
- **Principles:** Short paths for main tasks, clear hierarchy, no duplicate entries, aligned with Hub’s stateless routing.

---

## 2. Entry flow

### 2.1 Before connection

- **Single entry:** Connect page (ConnectForm).
- **Input:** Gateway URL (required), Token / Password (optional).
- **Sources:** Local storage (last URL/Token, auto-fill only; no auto-connect); URL params `?gatewayUrl=...&token=...` for deep links; clear query after connect to avoid leaking.
- **Default URL:** For local dev, default `ws://127.0.0.1:9347`; production or non-localhost leave empty.
- **Errors:** Show error below form on failure; for “invalid request frame” show “Please confirm this is a ParameciumU Gateway”.

### 2.2 After connection

- **Main UI:** Sidebar + main area; **default first screen = Messages** (recent chats + chat panel).
- **Disconnect:** “Disconnect” in sidebar or in Settings → back to connect page, clear connection state.
- **Reconnect:** After disconnect, connecting again is a new connection; no automatic reconnect (can be added later).

### 2.3 Flow summary

```
[Open Control UI]
        │
        ▼
  ┌─────────────┐
  │ Connect     │  ← URL/Token from storage or ?gatewayUrl=&token=
  │ (URL required)│
  └──────┬──────┘
         │ Connected
         ▼
  ┌─────────────┐
  │ Main UI     │  Default tab = Messages
  │ Sidebar +   │
  │ main area   │
  └─────────────┘
```

---

## 3. Sessions: one set for all clients

- **Sessions are shared.** All clients (Control UI, TUI, Feishu via connector node) use the **same session store** in the Hub. There is no “one set for Feishu, another for Control UI”.
- **Storage:** `.gateway/sessions/sessions.json` (metadata) + `.gateway/sessions/transcripts/&lt;sessionKey&gt;.json`. Same sessionKey = same conversation regardless of which client sent the message.
- **sessionKey:** Control UI / TUI send `chat.send` with optional `sessionKey`; if omitted, Hub creates one (e.g. `agent:.first_paramecium:s-&lt;timestamp&gt;-&lt;random&gt;`). Feishu connector sends `connector.message.inbound`; Hub uses `connector:<connectorId>:chat:<chatId>` as sessionKey. All end up in the same store.
- **Session list:** “Messages” view calls `sessions.list` and gets **all** Hub sessions (Control UI, TUI, Feishu). Use sessionKey prefix or channel/displayName to distinguish.

---

## 4. Information architecture (current)

### 4.1 Top-level nav

- **Sidebar:** **Messages**, **Agent directory**, **Node capabilities**, **Settings** (WeChat-style). Messages is the default.

### 4.2 Structure

| Level | Name | Description |
|-------|------|-------------|
| **Primary** | Messages | Default. Left: “Recent chats” (by last activity); right: current chat. Read/unread via localStorage. |
| **Agent directory** | Agent directory | Agents grouped by **node**; select an agent to see status (online/offline, 90s heartbeat), cron (list + run now), history, “Send message”. |
| **Node capabilities** | Node capabilities | Nodes grouped by node; each node lists capabilities (e.g. browser); right panel shows capability UI (e.g. browser screenshot). |
| **Settings** | Settings | Gateway URL, disconnect, debug (health/status in a collapsible block). |

### 4.3 Sidebar sketch

```
┌─────────────────────┐
│ ● ParameciumU       │  Connection indicator + brand
├─────────────────────┤
│ Messages            │  Default → recent chats + chat panel
│ Agent directory     │  Agents by node; right: status, cron, history
│ Node capabilities   │  Nodes by capability; right: capability UI
│ Settings            │
├─────────────────────┤
│ Disconnect          │
└─────────────────────┘
```

---

## 5. Interaction (current)

### 5.1 Messages

- **Entry:** After connect, default tab = Messages; left = recent chats, right = chat or welcome.
- **Recent list:** Combines agents (from node.list, sorted by latest session updatedAt) and group/connector sessions; sort by time. Online = green dot (heartbeat within 90s); unread = red dot (localStorage `paramecium_u_chat_last_read`).
- **Select session:** Click agent → `openChat(agentId)`; click group → `openChat(agentId, sessionKey)`. Right panel shows conversation title and messages only; current agent/session from parent.

### 5.2 Agent directory

- **Left:** Groups by **node** (node label or nodeId); under each, list of agents with online/offline.
- **Right:** Selected agent → **Status** (online/offline, last heartbeat), **Cron** (cron.list + run now), **History** (sessions for this agent; open in Messages), **Send message** (switch to Messages and openChat(agentId)).

### 5.3 Node capabilities

- **Left:** Same node grouping; each node lists its capabilities (from registry, e.g. browser). **Right:** Selected node + capability → capability UI (e.g. BrowserPanel for screenshot). See [node-capabilities](./node-capabilities.md).

### 5.4 Settings

- Current Gateway URL, saved URLs, Token placeholder, Disconnect. **Debug:** Collapsible block with health + status raw JSON (dark style).

### 5.5 Cross-panel

| From | Action | To | Params |
|------|--------|-----|--------|
| Messages · recent | Click agent | Messages chat | agentId |
| Messages · recent | Click group | Messages chat | agentId, sessionKey |
| Agent directory | “Send message” or history item | Messages | agentId or agentId + sessionKey |

Use `openChat(agentId, sessionKey?)`; if no sessionKey, use that agent’s main session.

---

## 6. Routing (optional)

- **Current:** No URL routing; in-memory state (tab, openChatPayload).
- **Optional:** Hash or History routes, e.g. `#/chat`, `#/settings`, `#/chat?agentId=...&sessionKey=...` for sharing. Connect page stays separate; after connect, restore tab from hash, default `/chat`.

---

## 7. Summary

1. **Entry:** Connect page only; after connect, main UI default = Messages.
2. **Nav:** Messages, Agent directory, Node capabilities, Settings.
3. **Messages:** Single recent-chat list, online/unread indicators, chat panel.
4. **Agent directory:** Agents by node; right = status, cron, history, send message.
5. **Settings:** Connection info, disconnect, debug block.

## Next steps

- [Node capabilities](./node-capabilities.md)
- [Gateway protocol](../gateway/protocol.md)
- [Apps](../runtime/apps.md)
- [Architecture](../concepts/architecture.md)
