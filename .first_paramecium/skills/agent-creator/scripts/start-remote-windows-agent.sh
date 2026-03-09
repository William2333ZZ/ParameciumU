#!/usr/bin/env bash
# Start a remote Windows agent via Scheduled Task (survives SSH disconnect).

set -euo pipefail
REMOTE_USER="${REMOTE_USER:-}"
REMOTE_HOST="${REMOTE_HOST:-}"
AGENT_ID="${AGENT_ID:-}"
GATEWAY_URL="${GATEWAY_URL:-}"
REMOTE_MONOU="${REMOTE_MONOU:-}"
REMOTE_AGENT_DIR="${REMOTE_AGENT_DIR:-}"
KILL_FIRST="${KILL_FIRST:-0}"

if [ -z "$REMOTE_USER" ] || [ -z "$REMOTE_HOST" ] || [ -z "$AGENT_ID" ] || [ -z "$GATEWAY_URL" ] || [ -z "$REMOTE_MONOU" ]; then
  echo "Required: REMOTE_USER REMOTE_HOST AGENT_ID GATEWAY_URL REMOTE_MONOU" >&2
  exit 1
fi

if [ -z "$REMOTE_AGENT_DIR" ]; then
  REMOTE_AGENT_DIR="${REMOTE_MONOU}\\agents\\${AGENT_ID}"
fi

TASK_NAME="MonouAgent_${AGENT_ID}"
REMOTE_MONOU_SCP="monoU"
BAT_NAME="start-${AGENT_ID}.bat"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MONOU_ROOT=""
d="$SCRIPT_DIR"
while [ -n "$d" ] && [ "$d" != "/" ]; do
  if [ -f "$d/package.json" ] && [ -d "$d/apps/gateway" ]; then
    MONOU_ROOT="$d"
    break
  fi
  d="$(dirname "$d")"
done
if [ -z "$MONOU_ROOT" ]; then
  echo "MONOU_ROOT not found." >&2
  exit 1
fi

BAT_PATH="${MONOU_ROOT}/.gateway/${BAT_NAME}"
mkdir -p "$(dirname "$BAT_PATH")"
cat > "$BAT_PATH" << EOF
@echo off
cd /d ${REMOTE_MONOU}
set GATEWAY_URL=${GATEWAY_URL}
set AGENT_ID=${AGENT_ID}
set AGENT_DIR=${REMOTE_AGENT_DIR}
node apps\\gateway\\dist\\agent-client.js
EOF
echo "Generated .bat: $BAT_PATH"

run_ssh() {
  if [ -n "$SSHPASS" ]; then
    sshpass -e ssh -o StrictHostKeyChecking=no "$REMOTE_USER@$REMOTE_HOST" "$@"
  else
    ssh -o StrictHostKeyChecking=no "$REMOTE_USER@$REMOTE_HOST" "$@"
  fi
}

run_scp() {
  if [ -n "$SSHPASS" ]; then
    sshpass -e scp -o StrictHostKeyChecking=no "$1" "$REMOTE_USER@$REMOTE_HOST:$2"
  else
    scp -o StrictHostKeyChecking=no "$1" "$REMOTE_USER@$REMOTE_HOST:$2"
  fi
}

export SSHPASS

echo "[agent-creator] uploading .bat to remote ${REMOTE_MONOU_SCP}/..."
run_scp "$BAT_PATH" "${REMOTE_MONOU_SCP}/${BAT_NAME}"

WIN_BAT_TR="${REMOTE_MONOU}\\${BAT_NAME}"
echo "[agent-creator] creating/updating scheduled task ${TASK_NAME}..."
run_ssh "schtasks /create /tn \"${TASK_NAME}\" /tr \"${WIN_BAT_TR}\" /sc once /st 23:59 /sd 2030/01/01 /f"

if [ "$KILL_FIRST" = "1" ]; then
  echo "[agent-creator] killing existing node.exe on remote..."
  run_ssh "taskkill /F /IM node.exe 2>nul" || true
fi

echo "[agent-creator] triggering scheduled task..."
run_ssh "schtasks /run /tn \"${TASK_NAME}\""
echo "[agent-creator] done. Refresh Control UI node list."
rm -f "$BAT_PATH"
