# Sandbox Node

## What it is

`apps/sandbox-node` connects to the Gateway as `role=node` with `capabilities: ["sandbox"]`. It runs shell commands in an isolated workspace — either a persistent Docker container (`docker exec`) or a local subprocess — and exposes the results via `node.invoke`.

## Quick start

```bash
GATEWAY_URL=ws://127.0.0.1:9347 \
"$AGENT_DIR/skills/node-creator/scripts/start-sandbox-node.sh"
```

Or directly:

```bash
GATEWAY_URL=ws://127.0.0.1:9347 npm run sandbox-node
```

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GATEWAY_URL` | — | Gateway WebSocket address (**required**) |
| `SANDBOX_NODE_ID` | `sandbox-1` | Node ID used in `gateway_nodes_list` and `gateway_node_invoke` |
| `SANDBOX_WORKSPACE` | `os.tmpdir()/monou-sandbox-<nodeId>` | Working directory for commands |
| `SANDBOX_USE_DOCKER` | `1` (uses Docker) | Set to `0` to use local subprocess instead of Docker |
| `SANDBOX_IMAGE` | `debian:bookworm-slim` | Docker image for the sandbox container |

## Supported commands (via `gateway_node_invoke`)

| Command | Params | Description |
|---------|--------|-------------|
| `system.run` | `command: string[]`, optional `rawCommand: string` | Execute a command in the sandbox workspace. Returns `exitCode`, `stdout`, `stderr`. |
| `system.which` | `bins: string[]` | Check which binaries are available. Returns `{ bins: { name: path } }`. |

### Example invocations

```
gateway_node_invoke(nodeId, "system.run", { command: ["ls", "-la"] })
gateway_node_invoke(nodeId, "system.run", { command: ["python3", "-c", "print('hello')"] })
gateway_node_invoke(nodeId, "system.which", { bins: ["node", "python3", "git"] })
```

## Docker mode (default)

Uses a long-running container + `docker exec` — consistent with OpenClaw. The container persists between calls so state (installed packages, files) is preserved within a session.

Requires Docker to be installed and running on the host.

## Local subprocess mode (`SANDBOX_USE_DOCKER=0`)

Falls back to running commands directly as local subprocesses in `SANDBOX_WORKSPACE`. No container isolation — use only when Docker is not available or for trusted workloads.

## Prerequisites

- `npm run build` in monoU root (builds `apps/sandbox-node/dist/index.js`).
- Docker installed and running (for default Docker mode).
