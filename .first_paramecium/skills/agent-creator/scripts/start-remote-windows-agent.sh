#!/usr/bin/env bash
# Start agent-client on a remote Windows machine using a scheduled task,
# so the process survives SSH disconnection.
#
# Usage:
#   REMOTE_USER=<user> REMOTE_HOST=<host> \
#   AGENT_ID=<agent_id> \
#   GATEWAY_URL=ws://<local-address>:9347 \
#   REMOTE_MONOU='C:\Users\<username>\monoU' \
#   [SSHPASS=<password>] [KILL_FIRST=1] \
#   "$AGENT_DIR/skills/agent-creator/scripts/start-remote-windows-agent.sh"
#
# Environment variables:
#   REMOTE_USER        Remote SSH username (required).
#   REMOTE_HOST        Remote IP or hostname (required).
#   AGENT_ID           Agent ID, e.g. win_agent (required).
#   GATEWAY_URL        Gateway WebSocket address (required).
#   REMOTE_MONOU       Windows absolute path to monoU on the remote,
#                      e.g. C:\Users\<username>\monoU (required).
#   REMOTE_AGENT_DIR   Remote agent dir; defaults to REMOTE_MONOU\agents\AGENT_ID.
#   SSHPASS            Optional SSH password (requires sshpass on local machine).
#   KILL_FIRST         Set to 1 to kill any existing node.exe before starting.

set -e
REMOTE_USER="${REMOTE_USER:-}"
REMOTE_HOST="${REMOTE_HOST:-}"
AGENT_ID="${AGENT_ID:-}"
GATEWAY_URL="${GATEWAY_URL:-}"
REMOTE_MONOU="${REMOTE_MONOU:-}"
REMOTE_AGENT_DIR="${REMOTE_AGENT_DIR:-}"
KILL_FIRST="${KILL_FIRST:-0}"

if [ -z "$REMOTE_USER" ] || [ -z "$REMOTE_HOST" ] || [ -z "$AGENT_ID" ] || [ -z "$GATEWAY_URL" ] || [ -z "$REMOTE_MONOU" ]; then
  echo "Usage: REMOTE_USER=... REMOTE_HOST=... AGENT_ID=... GATEWAY_URL=... REMOTE_MONOU=... $0" >&2
  echo "  REMOTE_MONOU: Windows absolute path to monoU on the remote, e.g. C:\\Users\\<username>\\monoU" >&2
  echo "  Optional: REMOTE_AGENT_DIR=... SSHPASS=... KILL_FIRST=1" >&2
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

echo "Uploading .bat to remote ${REMOTE_MONOU_SCP}/..."
run_scp "$BAT_PATH" "${REMOTE_MONOU_SCP}/${BAT_NAME}"

WIN_BAT_TR="${REMOTE_MONOU}\\${BAT_NAME}"
echo "Creating/updating scheduled task ${TASK_NAME}..."
run_ssh "schtasks /create /tn \"${TASK_NAME}\" /tr \"${WIN_BAT_TR}\" /sc once /st 23:59 /sd 2030/01/01 /f"

if [ "$KILL_FIRST" = "1" ]; then
  echo "Killing existing node.exe on remote..."
  run_ssh "taskkill /F /IM node.exe 2>nul" || true
fi

echo "Triggering scheduled task..."
run_ssh "schtasks /run /tn \"${TASK_NAME}\""
echo "Done. The agent should connect to the Gateway within a few seconds. Refresh the node list in Control UI."
rm -f "$BAT_PATH"
