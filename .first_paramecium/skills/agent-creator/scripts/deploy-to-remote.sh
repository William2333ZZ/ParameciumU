#!/usr/bin/env bash
# 将 monoU 同步到远程主机。
# 用法:
#   MONOU_ROOT=/path/to/monoU REMOTE_USER=user REMOTE_HOST=host REMOTE_PATH=~/monoU ./deploy-to-remote.sh
# 环境变量:
#   MONOU_ROOT    monoU 仓库根目录（默认当前脚本所在目录向上找到含 package.json 的 monoU 根）
#   REMOTE_USER   远程 SSH 用户（必填）
#   REMOTE_HOST   远程主机（必填）
#   REMOTE_PATH   远程目标路径，例如 ~/monoU 或 /opt/monoU（必填）
#   RSYNC_EXCLUDE 额外排除项，空格分隔，例如 "dist .env"

set -e
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
  echo "MONOU_ROOT not set or invalid. Set MONOU_ROOT to monoU repo root." >&2
  exit 1
fi

if [ -z "$REMOTE_USER" ] || [ -z "$REMOTE_HOST" ] || [ -z "$REMOTE_PATH" ]; then
  echo "Usage: REMOTE_USER=user REMOTE_HOST=host REMOTE_PATH=~/monoU [MONOU_ROOT=/path] $0" >&2
  exit 1
fi

EXCLUDES="--exclude node_modules --exclude .git --exclude dist"
for x in $RSYNC_EXCLUDE; do EXCLUDES="$EXCLUDES --exclude $x"; done

echo "Syncing $MONOU_ROOT to $REMOTE_USER@$REMOTE_HOST:$REMOTE_PATH"
rsync -avz $EXCLUDES "$MONOU_ROOT/" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_PATH/"

echo "Done. On remote run: cd $REMOTE_PATH && npm install && npm run build"
