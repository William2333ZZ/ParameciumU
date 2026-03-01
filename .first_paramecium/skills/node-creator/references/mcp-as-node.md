# Bridging MCP Servers as Gateway Nodes

## Why bridge MCP to node.invoke

MCP (Model Context Protocol) servers expose tools to LLM clients. A monoU node exposes commands to agents via `node.invoke`. The two protocols are structurally similar — both describe a set of named operations with typed inputs and outputs — so any MCP server can be wrapped as a Gateway node.

Once bridged, agents can call MCP tools through `gateway_node_invoke`, and the node appears in `gateway_nodes_list` with a capability like `["mcp:filesystem"]`.

## Protocol mapping

| MCP | monoU node.invoke |
|-----|-------------------|
| Server with tool list | Node with `capabilities` |
| `tools/list` → `[{ name, description, inputSchema }]` | Connect message: `capabilities: ["mcp:<server-name>"]` |
| `tools/call` → `{ name, arguments }` | `node.invoke.request` → `{ command: "<tool-name>", params: { ... } }` |
| `CallToolResult` → `{ content: [...] }` | `node.invoke.result` → `{ ok: true, payload: { content } }` |

## Generic MCP-to-node adapter (TypeScript)

This adapter connects to any MCP server over stdio and bridges it to the Gateway as a node.

```typescript
import WebSocket from "ws";
import { spawn } from "child_process";
import * as readline from "readline";

const GATEWAY_URL = process.env.GATEWAY_URL ?? "ws://127.0.0.1:9347";
const NODE_ID     = process.env.MCP_NODE_ID ?? "mcp-node-1";
const MCP_CMD     = process.env.MCP_CMD!;          // e.g. "npx"
const MCP_ARGS    = (process.env.MCP_ARGS ?? "").split(" ").filter(Boolean); // e.g. ["-y","@modelcontextprotocol/server-filesystem","/tmp"]
const SERVER_NAME = process.env.MCP_NAME ?? "mcp"; // used in capabilities

// ── MCP stdio transport ──────────────────────────────────────────────────────

const mcpProc = spawn(MCP_CMD, MCP_ARGS, { stdio: ["pipe", "pipe", "inherit"] });
const mcpIn   = mcpProc.stdin;
const mcpOut  = readline.createInterface({ input: mcpProc.stdout! });

let msgId = 1;
const pending = new Map<number, (result: unknown) => void>();

mcpOut.on("line", (line) => {
  try {
    const msg = JSON.parse(line);
    if (msg.id != null && pending.has(msg.id)) {
      pending.get(msg.id)!(msg.result ?? msg.error);
      pending.delete(msg.id);
    }
  } catch {}
});

function mcpCall(method: string, params: unknown): Promise<unknown> {
  return new Promise((resolve) => {
    const id = msgId++;
    pending.set(id, resolve);
    mcpIn.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

// Initialize MCP server
async function initMcp() {
  await mcpCall("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "monou-bridge", version: "1.0" },
  });
  await mcpCall("notifications/initialized", {});
}

// ── Gateway WebSocket ────────────────────────────────────────────────────────

async function main() {
  await initMcp();

  // Discover tools from MCP server
  const toolsResult = await mcpCall("tools/list", {}) as { tools?: Array<{ name: string }> };
  const toolNames = (toolsResult?.tools ?? []).map((t) => t.name);
  console.log(`MCP tools discovered: ${toolNames.join(", ")}`);

  const ws = new WebSocket(GATEWAY_URL);

  ws.on("open", () => {
    ws.send(JSON.stringify({
      type: "connect",
      role: "node",
      deviceId: NODE_ID,
      capabilities: [`mcp:${SERVER_NAME}`],
      // Optional: expose tool names as metadata
      meta: { tools: toolNames },
    }));
    console.log(`Connected to Gateway as ${NODE_ID}`);
  });

  ws.on("message", async (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type !== "node.invoke.request") return;

    const { invokeId, command, params } = msg;

    // Special command: list available tools
    if (command === "tools.list") {
      const result = await mcpCall("tools/list", {});
      ws.send(JSON.stringify({ type: "node.invoke.result", invokeId, result: { ok: true, payload: result } }));
      return;
    }

    // Forward command as MCP tool call
    try {
      const mcpResult = await mcpCall("tools/call", { name: command, arguments: params ?? {} });
      ws.send(JSON.stringify({ type: "node.invoke.result", invokeId, result: { ok: true, payload: mcpResult } }));
    } catch (e) {
      ws.send(JSON.stringify({
        type: "node.invoke.result", invokeId,
        result: { ok: false, error: { message: e instanceof Error ? e.message : String(e) } },
      }));
    }
  });

  ws.on("close", () => { mcpProc.kill(); process.exit(0); });
  ws.on("error", (e) => { console.error(e); mcpProc.kill(); process.exit(1); });
}

main().catch((e) => { console.error(e); process.exit(1); });
```

## Usage examples

### Filesystem MCP server

```bash
MCP_CMD=npx \
MCP_ARGS="-y @modelcontextprotocol/server-filesystem /Users/me/docs" \
MCP_NAME=filesystem \
MCP_NODE_ID=mcp-filesystem \
GATEWAY_URL=ws://127.0.0.1:9347 \
node mcp-bridge.js
```

Then from the agent:
```
gateway_node_invoke("mcp-filesystem", "read_file", { path: "/Users/me/docs/notes.md" })
gateway_node_invoke("mcp-filesystem", "list_directory", { path: "/Users/me/docs" })
gateway_node_invoke("mcp-filesystem", "tools.list", {})  // see all available tools
```

### GitHub MCP server

```bash
MCP_CMD=npx \
MCP_ARGS="-y @modelcontextprotocol/server-github" \
MCP_NAME=github \
MCP_NODE_ID=mcp-github \
GITHUB_PERSONAL_ACCESS_TOKEN=ghp_xxx \
GATEWAY_URL=ws://127.0.0.1:9347 \
node mcp-bridge.js
```

## Key differences from native MCP usage

| | Direct MCP (Claude Desktop) | Via monoU node |
|--|---------------------------|----------------|
| Who calls tools | LLM client | Any agent via gateway_node_invoke |
| Discovery | Client reads tool list at startup | `gateway_nodes_list` + `tools.list` command |
| Multi-agent | Single client | All agents on the Gateway can share the node |
| Persistence | Restarts with app | Node process runs independently |

## HTTP-based MCP servers

For MCP servers using HTTP transport (Streamable HTTP or SSE) instead of stdio, replace the `mcpProc`/stdio section with `fetch` calls to the MCP server's HTTP endpoint. The `node.invoke` handler logic stays identical.
