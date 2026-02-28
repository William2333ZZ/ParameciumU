#!/usr/bin/env bash
# Create an agent directory from template (if needed) and start the agent connected to Gateway.
# Run from monorepo root. Example:
#   AGENT_ID=my_agent GATEWAY_URL=ws://127.0.0.1:9347 ./.first_paramecium/skills/agent-creator/scripts/create-and-connect.sh
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# From scripts/ -> agent-creator/ -> skills/ -> .first_paramecium (or agent root) -> repo root
ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
cd "$ROOT"

AGENT_ID="${AGENT_ID:?AGENT_ID is required}"
GATEWAY_URL="${GATEWAY_URL:?GATEWAY_URL is required}"
AGENT_DIR="${AGENT_DIR:-$ROOT/agents/$AGENT_ID}"
export AGENT_DIR AGENT_ID GATEWAY_URL

if ! node -e "
const path = require('path');
const { ensureAgentDir } = require('@monou/agent-template');
ensureAgentDir({ agentDir: path.resolve(process.env.AGENT_DIR) });
" 2>/dev/null; then
  # Fallback: copy template if in monorepo
  TEMPLATE="$ROOT/packages/agent-template/template"
  if [ -d "$TEMPLATE" ]; then
    mkdir -p "$(dirname "$AGENT_DIR")"
    cp -R "$TEMPLATE" "$AGENT_DIR"
  else
    echo "Error: could not ensure agent dir (need @monou/agent-template or monorepo template at packages/agent-template/template)" >&2
    exit 1
  fi
fi

exec env GATEWAY_URL="$GATEWAY_URL" AGENT_ID="$AGENT_ID" AGENT_DIR="$AGENT_DIR" npm run agent
