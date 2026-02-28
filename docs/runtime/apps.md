# Apps

Applications in the repo that you run directly. Implementation details are in each app’s source.

## Gateway (`apps/gateway`)

- **Run**: `npm run gateway` (root) → `node apps/gateway/dist/index.js`.
- **Role**: WebSocket server; health, cron.*, connect, agents, sessions, agent, chat.*, node.*, connector.*. Does not run LLM; forwards agent runs to the connected Agent process.
- **Env**: `GATEWAY_PORT`, `GATEWAY_HOST`, `GATEWAY_DATA_DIR`, `CRON_STORE`, `GATEWAY_AGENT_HEARTBEAT_TIMEOUT_MS`, `GATEWAY_TOKEN`, `GATEWAY_PASSWORD`, `GATEWAY_TLS_CERT`, `GATEWAY_TLS_KEY`.
- **Build**: Depends on `@monou/gateway`, `@monou/cron`, `@monou/agent-from-dir`, `@monou/agent-sdk`, `@monou/shared`; build from root with `npm run build`.

## Agent (`apps/agent`)

- **Run**: `GATEWAY_URL=... AGENT_ID=... AGENT_DIR=... npm run agent`.
- **Role**: Connects to Gateway as `role: "agent"`, registers with `agentId`; on `node.invoke` (or internal agent run) loads the agent dir via `buildSessionFromU` / `createAgentContextFromU` and runs one turn with `runAgentTurnWithTools`. Also runs the cron scheduler for `AGENT_DIR/cron/jobs.json`; creates default Heartbeat job on first connect if missing.
- **Env**: `GATEWAY_URL` or `GATEWAY_WS_URL`, `AGENT_ID`, `AGENT_DIR` (required); optional `DEVICE_ID`, `GATEWAY_TOKEN`, `GATEWAY_PASSWORD`. Heartbeat: `HEARTBEAT_ACTIVE_HOURS_START`, `HEARTBEAT_ACTIVE_HOURS_END`, `HEARTBEAT_ACTIVE_HOURS_TZ`, and behavior for HEARTBEAT.md / HEARTBEAT_OK (see app source).
- **Build**: Depends on `@monou/agent-from-dir`, `@monou/agent-sdk`, `@monou/cron`, `@monou/shared`.

## Control UI (`apps/control-ui`)

- **Run**: `npm run control-ui` (Vite dev server); production: build with workspace script and serve the built app.
- **Role**: Web UI to connect to the Gateway (WebSocket URL), list agents/sessions, send chat messages, view history. Uses Gateway protocol (connect, chat.send, chat.history, etc.).
- **Config**: Gateway URL is entered in the UI (e.g. `ws://127.0.0.1:9347`).

## TUI (`apps/tui`)

- **Run**: `npm run tui` or `node apps/tui/dist/index.js`.
- **Role**: Terminal UI to talk to the agent via the Gateway (same protocol as Control UI, different front-end).

## Other apps

- **browser-node**: Headless browser node for browser_skill (e.g. fetch, click, fill). Invoked via Gateway node.* when configured.
- **feishu-app**: Feishu connector integration; see app directory and env.example there.
- **sandbox-node**: Sandboxed execution if used by the stack; see app directory.

All of the above are part of the monorepo; build order is defined in the root `package.json` and workspace dependencies.
