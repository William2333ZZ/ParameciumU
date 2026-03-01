#!/usr/bin/env bash
# Start agent-client and connect to the Gateway, making the agent visible in Control UI.
# Confirm the Gateway address before running (see references/gateway-connect.md).
# If GATEWAY_URL is not set, the script tries GATEWAY_WS_URL from MONOU_ROOT/.env,
# then falls back to ws://127.0.0.1:9347.
#
# Usage:
#   GATEWAY_URL=ws://127.0.0.1:9347 AGENT_ID=my_agent AGENT_DIR=/path/to/agent ./start-agent-client.sh
#
# Environment variables:
#   GATEWAY_URL       Gateway WebSocket address (falls back to GATEWAY_WS_URL or ws://127.0.0.1:9347).
#   AGENT_ID          Agent ID to register with the Gateway (required).
#   AGENT_DIR         Absolute path to the agent directory — same structure as .first_paramecium (required).
#   DEVICE_ID         Optional. Defaults to hostname. Agents sharing a DEVICE_ID are grouped as one
#                     device node in the topology view. Set DEVICE_ID=$AGENT_ID for one node per agent.
#   MONOU_ROOT        monoU repo root; auto-detected from script location if not set.
#   GATEWAY_TOKEN /
#   GATEWAY_PASSWORD  Optional Gateway authentication.

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATEWAY_URL="${GATEWAY_URL:-}"
AGENT_ID="${AGENT_ID:-}"
AGENT_DIR="${AGENT_DIR:-}"
DEVICE_ID="${DEVICE_ID:-$(hostname 2>/dev/null || echo 'local')}"
MONOU_ROOT="${MONOU_ROOT:-}"

if [ -z "$AGENT_ID" ] || [ -z "$AGENT_DIR" ]; then
  echo "Usage: GATEWAY_URL=ws://... AGENT_ID=<id> AGENT_DIR=<absolute-path> $0" >&2
  echo "  GATEWAY_URL defaults to GATEWAY_WS_URL from .env or ws://127.0.0.1:9347" >&2
  exit 1
fi

if [ -z "$MONOU_ROOT" ]; then
  d="$SCRIPT_DIR"
  while [ -n "$d" ] && [ "$d" != "/" ]; do
    if [ -f "$d/package.json" ] && [ -d "$d/apps/gateway" ]; then
      MONOU_ROOT="$d"
      break
    fi
    d="$(dirname "$d")"
  done
fi

if [ -z "$GATEWAY_URL" ]; then
  if [ -n "$MONOU_ROOT" ] && [ -f "$MONOU_ROOT/.env" ]; then
    set -a
    # shellcheck source=/dev/null
    . "$MONOU_ROOT/.env"
    set +a
  fi
  GATEWAY_URL="${GATEWAY_URL:-$GATEWAY_WS_URL}"
  GATEWAY_URL="${GATEWAY_URL:-ws://127.0.0.1:9347}"
  echo "GATEWAY_URL not set; using: $GATEWAY_URL (set GATEWAY_WS_URL in .env to change the default)" >&2
fi

if [ -z "$MONOU_ROOT" ] || [ ! -d "$MONOU_ROOT" ]; then
  echo "MONOU_ROOT not found. Set MONOU_ROOT to the monoU repo root." >&2
  exit 1
fi

CLIENT_JS="$MONOU_ROOT/apps/gateway/dist/agent-client.js"
if [ ! -f "$CLIENT_JS" ]; then
  echo "agent-client not found: $CLIENT_JS" >&2
  echo "Run 'npm run build' in the monoU root first." >&2
  exit 1
fi

export GATEWAY_URL AGENT_ID AGENT_DIR DEVICE_ID
exec node "$CLIENT_JS"
