---
name: gateway_skill
description: Complete toolset for interacting with the monoU Gateway. Discover topology (online agents, L3 nodes and their capabilities), query per-agent skills and cron jobs, delegate tasks to other agents, invoke L3 node capabilities (browser-node / sandbox-node via node.invoke, analogous to MCP servers), manage sessions, and push messages to connectors (e.g. Feishu). Use when the user asks about: who is online, what agents can do, scheduled tasks, delegating work to another agent, using browser or sandbox capabilities, sending messages to Feishu/channels, or viewing/sending to sessions. Requires Gateway connection.
---

# Gateway Skill

Interact with the monoU Gateway. All tools in this skill call through the Gateway WebSocket.

## Architecture

```
L1 Connectors (Feishu, Control UI)
        ↓
L2 Gateway  ← all tools here route through Gateway
        ↓              ↓
L3a Agent          L3b Node
(Runner)      (browser-node / sandbox-node)
               declares capabilities on connect;
               invoked via node.invoke (like MCP servers)
```

**L3 Nodes** connect with `role=node` and declare `capabilities` (e.g. `["browser"]`, `["sandbox"]`). Use `gateway_node_invoke` to call their commands — this is the MCP-equivalent mechanism in monoU, not skill files.

## Tools

### Topology

| Tool | Use |
|------|-----|
| **gateway_agents_list** | List all connected agents (agentId, deviceId, online, lastHeartbeatAt). |
| **gateway_nodes_list** | List L3 nodes (nodeId, capabilities) and L1 connectors (e.g. Feishu). |

### Skills & Cron

| Tool | Use |
|------|-----|
| **gateway_skills_status** | Get an agent's skill list (what it can do). Optional `agentId`, defaults to current agent. |
| **gateway_cron_list** | List an agent's scheduled jobs. Optional `agentId`, defaults to current agent. |

### Agent Delegation

| Tool | Use |
|------|-----|
| **gateway_agent_send_to_session** | Send a message to another agent's session; that agent executes and replies in that session. Required: `targetAgentId`, `message`. Optional: `sessionKey` (defaults to `agent:<targetAgentId>:main`). |

### Node Invocation (MCP-style)

| Tool | Use |
|------|-----|
| **gateway_node_invoke** | Invoke a command on an L3 node. Use `gateway_nodes_list` first to find `nodeId` and `capabilities`. browser-node: `browser_fetch`, `browser_click`, `browser_fill`, `browser_links`, `browser_screenshot`, `browser_pages`, `browser_switch`, `browser_new_tab`. sandbox-node: `system.run`, `system.which`. |

### Sessions

| Tool | Use |
|------|-----|
| **sessions_list** | List all sessions (sessionKey, sessionId, updatedAt, displayName). |
| **sessions_preview** | Same but fewer fields — quick overview. |
| **sessions_send** | Send a message to a session by `sessionKey`; triggers agent reply in that session. |

### Message Push

| Tool | Use |
|------|-----|
| **send_message** | Push a message to a connector channel (e.g. Feishu group/DM). Get `connectorId` from `gateway_nodes_list` connectors. Required: `connectorId`, `chatId`, `text`. |

## Common Patterns

- **"Who is online?"** → `gateway_agents_list`
- **"Is there a browser node?"** → `gateway_nodes_list` (check `capabilities` field)
- **"What can agent X do?"** → `gateway_skills_status(agentId)`
- **"Ask agent X to do Y"** → `gateway_agents_list` to confirm online → `gateway_agent_send_to_session`
- **"Open a URL with the browser"** → `gateway_nodes_list` to find node with `capabilities: ["browser"]` → `gateway_node_invoke(nodeId, "browser_fetch", { url })`
- **"Run a command in sandbox"** → `gateway_nodes_list` for `capabilities: ["sandbox"]` → `gateway_node_invoke(nodeId, "system.run", { command })`
- **"Send a Feishu message"** → `gateway_nodes_list` for connectorId → `send_message(connectorId, chatId, text)`
- **"Why isn't Feishu push working?"** → `gateway_nodes_list` to check connector status
- **"Did agent X's cron run?"** → `gateway_cron_list(agentId)`

## Guidelines

- All tools require Gateway. If not connected (no `GATEWAY_URL` set when agent started), tools return an error.
- For browser interactions beyond `gateway_node_invoke` (auto node selection, screenshot parsing), use `browser_skill` — it wraps `node.invoke` internally.
- Always run `gateway_agents_list` before delegating to confirm the target agent is online.

## More Scenarios

See [references/scenarios.md](references/scenarios.md) for discovery, capability queries, cron troubleshooting, orchestration, and combined usage examples.
