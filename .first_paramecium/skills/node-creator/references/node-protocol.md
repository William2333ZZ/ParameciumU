# Node Protocol: wrapping any service as a Gateway node

## Concept

A node is any process that:
1. Connects to the Gateway via WebSocket with `role: "node"`.
2. Declares what it can do via `capabilities: string[]` (e.g. `["browser"]`, `["sandbox"]`, `["feishu"]`).
3. Listens for `node.invoke.request` events and responds with `node.invoke.result`.

From an agent's perspective, calling a node is identical regardless of what software it wraps — the agent always uses `gateway_node_invoke(nodeId, command, params)`.

## Connection message

When the WebSocket opens, send:

```json
{
  "type": "connect",
  "role": "node",
  "deviceId": "<node-id>",
  "capabilities": ["<capability-1>", "<capability-2>"]
}
```

- `deviceId` is the node's identifier — this is what appears as `nodeId` in `gateway_nodes_list` and what agents pass to `gateway_node_invoke`.
- `capabilities` is a free-form list of strings describing what this node can do. Agents use `gateway_nodes_list` to discover available capabilities.

## Handling invocations

The Gateway sends `node.invoke.request` when an agent calls `gateway_node_invoke`:

```json
{
  "type": "node.invoke.request",
  "invokeId": "<uuid>",
  "command": "<command-name>",
  "params": { ... }
}
```

Respond with `node.invoke.result`:

```json
{
  "type": "node.invoke.result",
  "invokeId": "<same-uuid>",
  "result": {
    "ok": true,
    "payload": { ... }
  }
}
```

On error:

```json
{
  "type": "node.invoke.result",
  "invokeId": "<same-uuid>",
  "result": {
    "ok": false,
    "error": { "message": "something went wrong" }
  }
}
```

## TypeScript template

```typescript
import WebSocket from "ws";

const GATEWAY_URL = process.env.GATEWAY_URL ?? "ws://127.0.0.1:9347";
const NODE_ID = process.env.MY_NODE_ID ?? "my-node-1";
const CAPABILITIES = ["my-capability"];

const ws = new WebSocket(GATEWAY_URL);

ws.on("open", () => {
  ws.send(JSON.stringify({
    type: "connect",
    role: "node",
    deviceId: NODE_ID,
    capabilities: CAPABILITIES,
  }));
  console.log(`Connected as node: ${NODE_ID}`);
});

ws.on("message", async (raw) => {
  const msg = JSON.parse(raw.toString());

  if (msg.type === "node.invoke.request") {
    const { invokeId, command, params } = msg;
    let result: { ok: boolean; payload?: unknown; error?: { message: string } };

    try {
      if (command === "my_command") {
        const output = await doSomething(params);
        result = { ok: true, payload: output };
      } else {
        result = { ok: false, error: { message: `Unknown command: ${command}` } };
      }
    } catch (e) {
      result = { ok: false, error: { message: e instanceof Error ? e.message : String(e) } };
    }

    ws.send(JSON.stringify({ type: "node.invoke.result", invokeId, result }));
  }
});

ws.on("close", () => process.exit(0));
ws.on("error", (e) => { console.error(e); process.exit(1); });

async function doSomething(params: Record<string, unknown>) {
  // wrap your software here
  return { done: true };
}
```

## Examples of what you can wrap

| Software / service | capabilities | Example commands |
|-------------------|-------------|-----------------|
| Playwright browser | `["browser"]` | `browser_fetch`, `browser_click`, `browser_fill` |
| Docker exec | `["sandbox"]` | `system.run`, `system.which` |
| Python REPL | `["python"]` | `python.exec`, `python.eval` |
| Local SQLite | `["database"]` | `db.query`, `db.exec` |
| Feishu API | `["feishu"]` | `feishu.send`, `feishu.get_messages` |
| Home automation | `["smart-home"]` | `light.set`, `sensor.read` |
| Any REST API | `["my-api"]` | `api.get`, `api.post` |

## Discovery from the agent side

After the node connects, `gateway_nodes_list` will return it:

```json
{
  "nodes": [
    {
      "nodeId": "my-node-1",
      "deviceId": "my-node-1",
      "capabilities": ["my-capability"],
      "online": true
    }
  ]
}
```

The agent can then call:

```
gateway_node_invoke("my-node-1", "my_command", { ... })
```

## Packaging a custom node

A custom node is just a process — it can be:
- A standalone Node.js/Python/Go script.
- A Docker container that starts the WebSocket client on boot.
- A long-running daemon managed by systemd/launchd/Task Scheduler.

Place the entry script in `apps/` or anywhere accessible, and start it with `GATEWAY_URL` set. No changes to the Gateway or agent are needed.
