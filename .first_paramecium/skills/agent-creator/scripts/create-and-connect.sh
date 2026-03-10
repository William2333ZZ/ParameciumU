#!/usr/bin/env bash
# Create an agent directory and connect it to Gateway in one command.
#
# Usage:
#   AGENT_ID=my_agent [GATEWAY_URL=ws://127.0.0.1:9347] \
#     .first_paramecium/skills/agent-creator/scripts/create-and-connect.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_ID="${AGENT_ID:-}"
MONOU_ROOT="${MONOU_ROOT:-}"
GATEWAY_URL="${GATEWAY_URL:-}"
SKILLS="${SKILLS:-base_skill memory cron}"

if [ -z "$AGENT_ID" ]; then
  echo "AGENT_ID is required. Example: AGENT_ID=my_agent $0" >&2
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

if [ -z "$MONOU_ROOT" ] || [ ! -d "$MONOU_ROOT" ]; then
  echo "Failed to locate MONOU_ROOT." >&2
  exit 1
fi

if [ -z "$GATEWAY_URL" ] && [ -f "$MONOU_ROOT/.env" ]; then
  set -a
  # shellcheck source=/dev/null
  . "$MONOU_ROOT/.env"
  set +a
  GATEWAY_URL="${GATEWAY_URL:-${GATEWAY_WS_URL:-}}"
fi
GATEWAY_URL="${GATEWAY_URL:-ws://127.0.0.1:9347}"

AGENT_DIR="$MONOU_ROOT/agents/$AGENT_ID"
export AGENT_DIR MONOU_ROOT GATEWAY_URL AGENT_ID SKILLS

echo "[agent-creator] creating agent dir: $AGENT_DIR"
"$SCRIPT_DIR/create-agent-dir.sh"

# Safety net: ensure new agent has usable llm config
if [ ! -f "$AGENT_DIR/llm.json" ] && [ -f "$MONOU_ROOT/.first_paramecium/llm.json" ]; then
  cp "$MONOU_ROOT/.first_paramecium/llm.json" "$AGENT_DIR/llm.json"
fi

CLIENT_JS="$MONOU_ROOT/apps/agent/dist/index.js"
if [ ! -f "$CLIENT_JS" ]; then
  echo "[agent-creator] agent app not built, building @monou/agent..." >&2
  (cd "$MONOU_ROOT" && npm run build --workspace=@monou/agent)
fi

LOG="$MONOU_ROOT/.gateway/agent-$AGENT_ID.log"
mkdir -p "$(dirname "$LOG")"
echo "[agent-creator] starting agent app in background..."
nohup env GATEWAY_URL="$GATEWAY_URL" AGENT_ID="$AGENT_ID" AGENT_DIR="$AGENT_DIR" \
  "$SCRIPT_DIR/start-agent-client.sh" >> "$LOG" 2>&1 &

echo "[agent-creator] done"
echo "  AGENT_ID    : $AGENT_ID"
echo "  AGENT_DIR   : $AGENT_DIR"
echo "  GATEWAY_URL : $GATEWAY_URL"
echo "  LOG         : $LOG"
