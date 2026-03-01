#!/usr/bin/env bash
# Start browser-node and connect it to the Gateway.
# The node connects with role=node, declares capabilities: ["browser"],
# and handles node.invoke.request for browser commands (browser_fetch, browser_click, etc.).
# After starting, verify with gateway_nodes_list and invoke via gateway_node_invoke.
#
# Usage:
#   GATEWAY_URL=ws://127.0.0.1:9347 ./start-browser-node.sh
#   GATEWAY_URL=ws://127.0.0.1:9347 BROWSER_HEADED=1 BROWSER_USER_DATA_DIR=.gateway/browser-profile ./start-browser-node.sh
#
# Environment variables:
#   GATEWAY_URL            Gateway WebSocket address (required).
#   BROWSER_NODE_ID        Node ID to register as (default: browser-1).
#   BROWSER_USER_DATA_DIR  Path to persist browser profile (cookies/login state).
#                          Strongly recommended; without it login state is lost on restart.
#                          Suggested: .gateway/browser-profile
#   BROWSER_HEADED         Set to 1 for a visible browser window (useful for first login).
#   MONOU_ROOT             monoU repo root; auto-detected from script location if not set.

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

NODE_JS="$MONOU_ROOT/apps/browser-node/dist/index.js"
if [ ! -f "$NODE_JS" ]; then
  echo "browser-node not built: $NODE_JS" >&2
  echo "Run 'npm run build' in the monoU root first." >&2
  exit 1
fi

export GATEWAY_URL
echo "Starting browser-node (nodeId: ${BROWSER_NODE_ID:-browser-1}) → $GATEWAY_URL"
[ -n "$BROWSER_NODE_ID" ] && export BROWSER_NODE_ID
[ -n "$BROWSER_USER_DATA_DIR" ] && export BROWSER_USER_DATA_DIR
[ -n "$BROWSER_HEADED" ] && export BROWSER_HEADED
exec node "$NODE_JS"
