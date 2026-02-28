#!/usr/bin/env bash
# 启动 agent-client，连接指定 Gateway，使新 Agent 在 Control UI 可见。
# 必须先确认 Gateway 地址（见 references/gateway-connect.md）；未设置时使用默认 ws://127.0.0.1:9347（与 .env GATEWAY_WS_URL 一致）。
#
# 用法:
#   GATEWAY_URL=ws://127.0.0.1:9347 AGENT_ID=pilot AGENT_DIR=/path/to/agent node ...
#  或本脚本（未设 GATEWAY_URL 时会尝试从 MONOU_ROOT/.env 读取 GATEWAY_WS_URL）：
#   GATEWAY_URL=ws://127.0.0.1:9347 AGENT_ID=pilot AGENT_DIR=/path/to/agent ./start-agent-client.sh
#
# 环境变量:
#   GATEWAY_URL  Gateway WebSocket 地址（未设则用 GATEWAY_WS_URL 或默认 ws://127.0.0.1:9347）
#   AGENT_ID     注册到 Gateway 的 agentId（必填）
#   AGENT_DIR    该 Agent 目录绝对路径，与 .u 同构（必填）
#   DEVICE_ID    可选，默认本机 hostname（同机多 Agent 会聚成「一个设备节点」；设成 AGENT_ID 则一 Agent 一节点）
#   MONOU_ROOT   monoU 仓库根目录；未设则自动向上查找含 apps/gateway 的目录
#   GATEWAY_TOKEN / GATEWAY_PASSWORD  可选，Gateway 认证

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATEWAY_URL="${GATEWAY_URL:-}"
AGENT_ID="${AGENT_ID:-}"
AGENT_DIR="${AGENT_DIR:-}"
# 默认 DEVICE_ID=hostname，使同机多 Agent 在节点图中聚为一台「设备」
DEVICE_ID="${DEVICE_ID:-$(hostname 2>/dev/null || echo 'local')}"
MONOU_ROOT="${MONOU_ROOT:-}"

if [ -z "$AGENT_ID" ] || [ -z "$AGENT_DIR" ]; then
  echo "用法: GATEWAY_URL=ws://... AGENT_ID=<id> AGENT_DIR=<绝对路径> $0" >&2
  echo "  GATEWAY_URL 未设时使用 .env 的 GATEWAY_WS_URL 或默认 ws://127.0.0.1:9347" >&2
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
  echo "未设置 GATEWAY_URL，使用: $GATEWAY_URL（可在 .env 设 GATEWAY_WS_URL）" >&2
fi
if [ -z "$MONOU_ROOT" ] || [ ! -d "$MONOU_ROOT" ]; then
  echo "MONOU_ROOT 未找到，请设置 MONOU_ROOT 为 monoU 仓库根目录" >&2
  exit 1
fi

CLIENT_JS="$MONOU_ROOT/apps/gateway/dist/agent-client.js"
if [ ! -f "$CLIENT_JS" ]; then
  echo "未找到 agent-client: $CLIENT_JS，请先在 monoU 根目录执行 npm run build" >&2
  exit 1
fi

export GATEWAY_URL AGENT_ID AGENT_DIR DEVICE_ID
exec node "$CLIENT_JS"
