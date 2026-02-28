#!/usr/bin/env bash
# 一键：创建新 Agent 目录并后台启动 agent-client 连接 Gateway。
# 由 .u agent 调用，完成「建目录 → 连 Gateway」全流程。
#
# 用法（在 monoU 根目录执行）:
#   AGENT_ID=my_agent [GATEWAY_URL=ws://127.0.0.1:9347] ./scripts/create-and-connect.sh
#   未设 GATEWAY_URL 时会从 MONOU_ROOT/.env 读取 GATEWAY_WS_URL。
#
# 环境变量:
#   AGENT_ID    必填，新 agent 的 ID（目录名与注册名）
#   GATEWAY_URL 可选，默认从 .env 的 GATEWAY_WS_URL 或 ws://127.0.0.1:9347
#   MONOU_ROOT  可选，monoU 根目录，默认脚本向上查找

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_ID="${AGENT_ID:-}"
MONOU_ROOT="${MONOU_ROOT:-}"

if [ -z "$AGENT_ID" ]; then
  echo "用法: AGENT_ID=<id> [GATEWAY_URL=ws://127.0.0.1:9347] $0" >&2
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
  echo "MONOU_ROOT 未找到" >&2
  exit 1
fi

if [ -z "$GATEWAY_URL" ]; then
  if [ -f "$MONOU_ROOT/.env" ]; then
    set -a
    # shellcheck source=/dev/null
    . "$MONOU_ROOT/.env"
    set +a
  fi
  GATEWAY_URL="${GATEWAY_URL:-$GATEWAY_WS_URL}"
  GATEWAY_URL="${GATEWAY_URL:-ws://127.0.0.1:9347}"
fi

AGENT_DIR="${MONOU_ROOT}/agents/${AGENT_ID}"
export AGENT_DIR MONOU_ROOT GATEWAY_URL AGENT_ID

# 1. 创建 Agent 目录（必备技能 base_skill memory cron）
export SKILLS="base_skill memory cron"
"$SCRIPT_DIR/create-agent-dir.sh"
echo "Created: $AGENT_DIR"

# 2. 确保 gateway 已 build
if [ ! -f "$MONOU_ROOT/apps/gateway/dist/agent-client.js" ]; then
  echo "Building gateway..." >&2
  (cd "$MONOU_ROOT" && npm run build --workspace=@monou/gateway-app) || true
fi

# 3. 后台启动 agent-client（不阻塞）
LOG="${MONOU_ROOT}/.gateway/agent-${AGENT_ID}.log"
mkdir -p "$(dirname "$LOG")"
nohup env GATEWAY_URL="$GATEWAY_URL" AGENT_ID="$AGENT_ID" AGENT_DIR="$AGENT_DIR" "$SCRIPT_DIR/start-agent-client.sh" >> "$LOG" 2>&1 &
echo "Agent $AGENT_ID is connecting to $GATEWAY_URL in background. Log: $LOG"
echo "Done. Check Control UI for agent: $AGENT_ID"
