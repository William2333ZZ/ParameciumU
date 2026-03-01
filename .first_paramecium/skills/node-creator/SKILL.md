---
name: node-creator
description: Create, wrap, or start an L3 node and connect it to the Gateway. A node wraps any software or service (browser, sandbox, local tools, APIs, connectors) into a Gateway capability: it connects with role=node, declares capabilities[], and handles node.invoke.request — analogous to an MCP server. Use when the user wants to add browser capability (start browser-node), run sandbox commands (start sandbox-node), wrap a new service as a custom node, or understand how to expose any tool to agents via gateway_node_invoke.
---

# Node Creator

**What is a node?**

An L3 node is any process that connects to the Gateway with `role=node`, declares what it can do via `capabilities`, and handles `node.invoke.request` events. When an agent calls `gateway_node_invoke(nodeId, command, params)`, the Gateway forwards the request to the node, the node executes the command, and returns the result.

This is monoU's MCP-equivalent: nodes are capability servers that agents invoke on demand.

```
Agent  →  gateway_node_invoke(nodeId, command, params)
               ↓
           Gateway  (node.invoke forwarding)
               ↓
           Node process  (handles node.invoke.request, returns result)
```

**Any software can become a node.** The browser-node wraps Playwright. The sandbox-node wraps Docker. You could wrap a Python REPL, a local database, a hardware sensor, a third-party API — anything with a `node.invoke.request` handler.

## Starting existing nodes

### Browser node

Wraps Playwright WebKit. Exposes `browser_fetch`, `browser_click`, `browser_fill`, `browser_links`, `browser_screenshot`, `browser_pages`, `browser_switch`, `browser_new_tab`.

```bash
GATEWAY_URL=ws://127.0.0.1:9347 \
BROWSER_USER_DATA_DIR=.gateway/browser-profile \
"$AGENT_DIR/skills/node-creator/scripts/start-browser-node.sh"
```

See [references/browser-node.md](references/browser-node.md) for all env vars, Docker usage, and troubleshooting.

### Sandbox node

Wraps Docker exec (or local subprocess). Exposes `system.run`, `system.which`.

```bash
GATEWAY_URL=ws://127.0.0.1:9347 \
"$AGENT_DIR/skills/node-creator/scripts/start-sandbox-node.sh"
```

See [references/sandbox-node.md](references/sandbox-node.md) for Docker/no-Docker modes and env vars.

## Creating a custom node

To wrap a new service as a node, implement the `node.invoke.request` handler pattern:

1. Connect to the Gateway as `role=node` with your `capabilities` array.
2. Listen for `node.invoke.request` events.
3. Execute the requested `command` with `params`.
4. Send back `node.invoke.result` with `{ ok, payload }` or `{ ok: false, error }`.

**References:**

- [references/node-protocol.md](references/node-protocol.md) — full protocol spec, TypeScript template, command naming guidelines, reconnection and concurrency patterns.
- [references/software-patterns.md](references/software-patterns.md) — ready-to-use patterns for wrapping REST APIs, CLI tools, Python scripts, databases, webhooks, and multi-capability nodes.
- [references/mcp-as-node.md](references/mcp-as-node.md) — bridge an existing MCP (Model Context Protocol) server as a Gateway node, including a generic stdio adapter and HTTP MCP support.

## After starting a node

Verify with `gateway_nodes_list` — the new node should appear with its `nodeId` and `capabilities`.  
Then call it with `gateway_node_invoke(nodeId, command, params)`.
