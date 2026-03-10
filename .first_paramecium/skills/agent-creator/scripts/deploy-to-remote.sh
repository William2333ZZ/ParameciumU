#!/usr/bin/env bash
# Sync monoU to a remote host using rsync.
#
# Usage:
#   REMOTE_USER=<user> REMOTE_HOST=<host> REMOTE_PATH=~/monoU \
#   [MONOU_ROOT=/path/to/monoU] [RSYNC_EXCLUDE="dist .env"] \
#   .first_paramecium/skills/agent-creator/scripts/deploy-to-remote.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MONOU_ROOT="${MONOU_ROOT:-}"
REMOTE_USER="${REMOTE_USER:-}"
REMOTE_HOST="${REMOTE_HOST:-}"
REMOTE_PATH="${REMOTE_PATH:-}"

if [ -z "$MONOU_ROOT" ]; then
  d="$SCRIPT_DIR"
  while [ -n "$d" ] && [ "$d" != "/" ]; do
    [ -f "$d/package.json" ] && [ -d "$d/apps/gateway" ] && MONOU_ROOT="$d" && break
    d="$(dirname "$d")"
  done
fi
if [ -z "$MONOU_ROOT" ] || [ ! -d "$MONOU_ROOT" ]; then
  echo "MONOU_ROOT not set or invalid." >&2
  exit 1
fi

if [ -z "$REMOTE_USER" ] || [ -z "$REMOTE_HOST" ] || [ -z "$REMOTE_PATH" ]; then
  echo "REMOTE_USER / REMOTE_HOST / REMOTE_PATH are required." >&2
  exit 1
fi

EXCLUDES="--exclude node_modules --exclude .git --exclude dist"
for x in ${RSYNC_EXCLUDE:-}; do EXCLUDES="$EXCLUDES --exclude $x"; done

echo "[agent-creator] syncing $MONOU_ROOT -> $REMOTE_USER@$REMOTE_HOST:$REMOTE_PATH"
rsync -avz $EXCLUDES "$MONOU_ROOT/" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_PATH/"

echo "[agent-creator] done"
echo "Next on remote:"
echo "  cd $REMOTE_PATH && npm install && npm run build"
