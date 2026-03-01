#!/usr/bin/env bash
# Start sandbox-node and connect it to the Gateway.
# The node connects with role=node, declares capabilities: ["sandbox"],
# and handles node.invoke.request for system.run and system.which.
# After starting, verify with gateway_nodes_list and invoke via gateway_node_invoke.
#
# Usage:
#   GATEWAY_URL=ws://127.0.0.1:9347 ./start-sandbox-node.sh
#   GATEWAY_URL=ws://127.0.0.1:9347 SANDBOX_USE_DOCKER=0 ./start-sandbox-node.sh
#
# Environment variables:
#   GATEWAY_URL         Gateway WebSocket address (required).
#   SANDBOX_NODE_ID     Node ID to register as (default: sandbox-1).
#   SANDBOX_WORKSPACE   Working directory for commands inside the sandbox
#                       (default: os.tmpdir()/monou-sandbox-<nodeId>).
#   SANDBOX_USE_DOCKER  Set to 0 to use a local subprocess instead of Docker (default: uses Docker).
#   SANDBOX_IMAGE       Docker image to use (default: debian:bookworm-slim).
#   MONOU_ROOT          monoU repo root; auto-detected from script location if not set.

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATEWAY_URL="${GATEWAY_URL:-}"
MONOU_ROOT="${MONOU_ROOT:-}"

if [ -z "$GATEWAY_URL" ]; then
  echo "GATEWAY_URL is required." >&2
  echo "Usage: GATEWAY_URL=ws://127.0.0.1:9347 $0" >&2
  exit 1
fi

if [ -z "$MONOU_ROOT" ]; then
  d="$SCRIPT_DIR"
  while [ -n "$d" ] && [ "$d" != "/" ]; do
    [ -f "$d/package.json" ] && [ -d "$d/apps/gateway" ] && MONOU_ROOT="$d" && break
    d="$(dirname "$d")"
  done
fi
if [ -z "$MONOU_ROOT" ] || [ ! -d "$MONOU_ROOT" ]; then
  echo "MONOU_ROOT not found. Set MONOU_ROOT to the monoU repo root." >&2
  exit 1
fi

NODE_JS="$MONOU_ROOT/apps/sandbox-node/dist/index.js"
if [ ! -f "$NODE_JS" ]; then
  echo "sandbox-node not built: $NODE_JS" >&2
  echo "Run 'npm run build' in the monoU root first." >&2
  exit 1
fi

export GATEWAY_URL
echo "Starting sandbox-node (nodeId: ${SANDBOX_NODE_ID:-sandbox-1}) → $GATEWAY_URL"
[ -n "$SANDBOX_NODE_ID" ]     && export SANDBOX_NODE_ID
[ -n "$SANDBOX_WORKSPACE" ]   && export SANDBOX_WORKSPACE
[ -n "$SANDBOX_USE_DOCKER" ]  && export SANDBOX_USE_DOCKER
[ -n "$SANDBOX_IMAGE" ]       && export SANDBOX_IMAGE
exec node "$NODE_JS"
