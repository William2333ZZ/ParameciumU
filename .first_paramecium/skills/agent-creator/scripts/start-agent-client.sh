#!/usr/bin/env bash
# Start agent-client and connect to Gateway.
# Usage:
#   GATEWAY_URL=ws://127.0.0.1:9347 AGENT_ID=my_agent AGENT_DIR=/abs/path \
#   .first_paramecium/skills/agent-creator/scripts/start-agent-client.sh

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATEWAY_URL="${GATEWAY_URL:-}"
AGENT_ID="${AGENT_ID:-}"
AGENT_DIR="${AGENT_DIR:-}"
DEVICE_ID="${DEVICE_ID:-$(hostname 2>/dev/null || echo 'local')}"
MONOU_ROOT="${MONOU_ROOT:-}"

if [ -z "$AGENT_ID" ] || [ -z "$AGENT_DIR" ]; then
  echo "AGENT_ID and AGENT_DIR are required." >&2
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
  echo "[agent-creator] GATEWAY_URL not set; using: $GATEWAY_URL" >&2
fi

if [ -z "$MONOU_ROOT" ] || [ ! -d "$MONOU_ROOT" ]; then
  echo "MONOU_ROOT not found." >&2
  exit 1
fi

CLIENT_JS="$MONOU_ROOT/apps/gateway/dist/agent-client.js"
if [ ! -f "$CLIENT_JS" ]; then
  echo "agent-client not found: $CLIENT_JS" >&2
  echo "Run npm run build first." >&2
  exit 1
fi

export GATEWAY_URL AGENT_ID AGENT_DIR DEVICE_ID
echo "[agent-creator] start agent-client: AGENT_ID=$AGENT_ID AGENT_DIR=$AGENT_DIR GATEWAY_URL=$GATEWAY_URL"
exec node "$CLIENT_JS"
