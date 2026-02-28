#!/usr/bin/env bash
# 获取本机 LAN IP，并打印对方（远程）可用来连接本机 Gateway 的 GATEWAY_URL，便于测试或告知用户。
# 本机启动 Gateway 时需加 GATEWAY_HOST=0.0.0.0（或绑定到该 IP），否则外网连不上。
#
# 用法: ./get-local-gateway-url.sh [端口]
# 端口默认 9347（与 .env GATEWAY_WS_URL 一致）；可用环境变量 GATEWAY_PORT 或传入第一个参数。

PORT="${1:-${GATEWAY_PORT:-9347}}"
IP=""

if command -v ipconfig >/dev/null 2>&1; then
  IP=$(ipconfig getifaddr en0 2>/dev/null) || IP=$(ipconfig getifaddr en1 2>/dev/null)
fi
if [ -z "$IP" ] && command -v hostname >/dev/null 2>&1; then
  # fallback: try to get first non-loopback inet from ifconfig
  if [ "$(uname -s)" = "Darwin" ]; then
    IP=$(ifconfig 2>/dev/null | awk '/inet / && !/127.0.0.1/ {print $2; exit}')
  else
    IP=$(ip -4 route get 1 2>/dev/null | grep -oP 'src \K[0-9.]+' | head -1)
  fi
fi
if [ -z "$IP" ]; then
  IP="<本机IP>"
fi

echo "本机 LAN IP: $IP"
echo "Gateway 端口: $PORT"
echo "对方连接本机 Gateway 时使用:"
echo "  GATEWAY_URL=ws://${IP}:${PORT}"
echo ""
echo "注意: 本机启动 Gateway 时需加 GATEWAY_HOST=0.0.0.0 才能被同网段其他机器连接，例如:"
echo "  GATEWAY_HOST=0.0.0.0 GATEWAY_PORT=${PORT} npm run gateway"
