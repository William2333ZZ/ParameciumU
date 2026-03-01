# Software-to-Node Patterns

Patterns for wrapping different types of software as Gateway nodes. Each pattern shares the same skeleton from `node-protocol.md`; only the `doWork()` part differs.

---

## Pattern 1: REST API wrapper

Wrap any HTTP API so agents can call it without dealing with auth headers or request format.

```typescript
// capabilities: ["my-api"]
// commands: api.get, api.post, api.put, api.delete

const BASE_URL = process.env.API_BASE_URL!;
const API_KEY  = process.env.API_KEY!;

async function handleInvoke(command: string, params: Record<string, unknown>) {
  const { path, body, query } = params as {
    path: string;
    body?: unknown;
    query?: Record<string, string>;
  };

  const url = new URL(path, BASE_URL);
  if (query) Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));

  const method = {
    "api.get":    "GET",
    "api.post":   "POST",
    "api.put":    "PUT",
    "api.delete": "DELETE",
  }[command];

  if (!method) throw new Error(`Unknown command: ${command}`);

  const res = await fetch(url.toString(), {
    method,
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: body != null ? JSON.stringify(body) : undefined,
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`API error ${res.status}: ${JSON.stringify(data)}`);
  return data;
}
```

**Example**: wrap Notion API, Linear, Slack, any internal service.

---

## Pattern 2: CLI tool wrapper

Run command-line tools in a controlled workspace. Good for compilers, linters, build tools, data processors.

```typescript
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";

const execFileAsync = promisify(execFile);
const WORKSPACE = process.env.TOOL_WORKSPACE ?? "/tmp/node-workspace";

// capabilities: ["ffmpeg"]
// commands: ffmpeg.run

async function handleInvoke(command: string, params: Record<string, unknown>) {
  if (command === "ffmpeg.run") {
    const args = params.args as string[];  // e.g. ["-i","input.mp4","-vn","output.mp3"]
    const { stdout, stderr } = await execFileAsync("ffmpeg", args, { cwd: WORKSPACE });
    return { stdout, stderr };
  }

  if (command === "ffmpeg.probe") {
    const file = params.file as string;
    const { stdout } = await execFileAsync(
      "ffprobe", ["-v","quiet","-print_format","json","-show_format","-show_streams", file],
      { cwd: WORKSPACE }
    );
    return JSON.parse(stdout);
  }

  throw new Error(`Unknown command: ${command}`);
}
```

**Example**: ffmpeg, ImageMagick, pandoc, git, any shell tool.

---

## Pattern 3: Python / script runner

Execute Python code snippets or scripts, return stdout. Useful for data analysis, ML inference, scientific computing.

```typescript
import { spawn } from "child_process";

// capabilities: ["python"]
// commands: python.exec, python.eval

async function handleInvoke(command: string, params: Record<string, unknown>) {
  const code   = params.code as string;
  const inputs = (params.inputs ?? {}) as Record<string, unknown>;

  // Inject inputs as a JSON string so the script can access them
  const preamble = `import json; _inputs = json.loads(${JSON.stringify(JSON.stringify(inputs))})\n`;
  const fullCode = command === "python.eval"
    ? `${preamble}print(json.dumps(eval(${JSON.stringify(code)})))`
    : `${preamble}${code}`;

  return new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve) => {
    const proc = spawn("python3", ["-c", fullCode]);
    let stdout = "", stderr = "";
    proc.stdout.on("data", (d) => { stdout += d; });
    proc.stderr.on("data", (d) => { stderr += d; });
    proc.on("close", (code) => resolve({ stdout, stderr, exitCode: code ?? 0 }));
  });
}
```

**Example**: pandas data analysis, matplotlib charts, scipy, custom ML scripts.

---

## Pattern 4: Stateful / long-running service

Keep a persistent connection or state across invocations (database connection, REPL session, browser session).

```typescript
import Database from "better-sqlite3";

// capabilities: ["sqlite"]
// commands: db.query, db.exec, db.schema

let db: Database.Database | null = null;

function getDb(path: string) {
  if (!db) db = new Database(path);
  return db;
}

async function handleInvoke(command: string, params: Record<string, unknown>) {
  const dbPath = (params.db as string) ?? process.env.DB_PATH ?? ":memory:";
  const database = getDb(dbPath);

  if (command === "db.query") {
    const rows = database.prepare(params.sql as string).all(...(params.bindings as unknown[] ?? []));
    return { rows };
  }

  if (command === "db.exec") {
    const info = database.prepare(params.sql as string).run(...(params.bindings as unknown[] ?? []));
    return { changes: info.changes, lastInsertRowid: info.lastInsertRowid };
  }

  if (command === "db.schema") {
    const tables = database.prepare(
      "SELECT name, sql FROM sqlite_master WHERE type='table'"
    ).all();
    return { tables };
  }

  throw new Error(`Unknown command: ${command}`);
}
```

**Example**: SQLite, Redis, Postgres connection pool, in-memory state machine.

---

## Pattern 5: Event bridge (webhooks → node.invoke)

Receive webhooks or events from external systems, forward to agents via `gateway_agent_send_to_session` or expose as queryable state.

```typescript
import express from "express";
import WebSocket from "ws";

// capabilities: ["webhook-receiver"]
// commands: events.list, events.clear

const events: Array<{ ts: number; source: string; payload: unknown }> = [];
let gatewayWs: WebSocket;

// HTTP server to receive webhooks
const app = express();
app.use(express.json());
app.post("/webhook/:source", (req, res) => {
  events.push({ ts: Date.now(), source: req.params.source, payload: req.body });
  // Optionally forward to Gateway immediately:
  // gatewayWs.send(JSON.stringify({ type: "... agent notification ..." }));
  res.json({ ok: true });
});
app.listen(Number(process.env.WEBHOOK_PORT ?? 3001));

// node.invoke handler
async function handleInvoke(command: string, params: Record<string, unknown>) {
  if (command === "events.list") {
    const since = (params.sinceMs as number) ?? 0;
    return { events: events.filter((e) => e.ts > since) };
  }
  if (command === "events.clear") {
    events.length = 0;
    return { cleared: true };
  }
  throw new Error(`Unknown command: ${command}`);
}
```

**Example**: receive Feishu event webhooks, GitHub webhooks, IoT sensor pushes, payment notifications.

---

## Pattern 6: Multi-capability node

One node can declare multiple capabilities. Useful when related services belong together.

```typescript
// capabilities: ["files", "archive"]

async function handleInvoke(command: string, params: Record<string, unknown>) {
  if (command.startsWith("files.")) return handleFiles(command, params);
  if (command.startsWith("archive.")) return handleArchive(command, params);
  throw new Error(`Unknown command: ${command}`);
}
```

---

## Design guidelines

**Command naming**: use `<domain>.<verb>` format — `browser_fetch`, `db.query`, `files.read`. This makes routing and documentation clear.

**Params schema**: keep params flat and JSON-serializable. Avoid binary data in params — use file paths or URLs instead, and let the node read/write files on the shared filesystem.

**Errors**: always return `{ ok: false, error: { message: "..." } }` rather than throwing past the handler — unexpected exceptions should be caught and converted.

**Concurrency**: decide up front whether your node handles concurrent invocations. If the underlying service is not safe for concurrent use (e.g. a single browser tab), serialize requests:

```typescript
let busy = false;
const queue: Array<() => void> = [];

function withLock(fn: () => Promise<unknown>) {
  return new Promise((resolve, reject) => {
    const run = async () => {
      busy = true;
      try { resolve(await fn()); } catch (e) { reject(e); } finally {
        busy = false;
        queue.shift()?.();
      }
    };
    if (busy) queue.push(run);
    else run();
  });
}
```

**Reconnection**: the Gateway may restart. Wrap your WebSocket client with exponential-backoff reconnection so the node recovers automatically:

```typescript
function connect() {
  const ws = new WebSocket(GATEWAY_URL);
  ws.on("open", onOpen);
  ws.on("message", onMessage);
  ws.on("close", () => setTimeout(connect, 3000)); // reconnect after 3s
  ws.on("error", () => {});  // suppress uncaught error
}
connect();
```

**Lifecycle**: emit a `connected` log on `open` and a `disconnected` log on `close`. This makes it easy to confirm the node is live in the Gateway topology.
