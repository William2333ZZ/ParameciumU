#!/usr/bin/env bash
# Print a reachable local Gateway URL for remote hosts.
# Usage: get-local-gateway-url.sh [port]

PORT="${1:-${GATEWAY_PORT:-9347}}"
IP=""

if command -v ipconfig >/dev/null 2>&1; then
  IP=$(ipconfig getifaddr en0 2>/dev/null) || IP=$(ipconfig getifaddr en1 2>/dev/null)
fi
if [ -z "$IP" ] && command -v hostname >/dev/null 2>&1; then
  if [ "$(uname -s)" = "Darwin" ]; then
    IP=$(ifconfig 2>/dev/null | awk '/inet / && !/127.0.0.1/ {print $2; exit}')
  else
    IP=$(ip -4 route get 1 2>/dev/null | grep -oP 'src \K[0-9.]+' | head -1)
  fi
fi
if [ -z "$IP" ]; then
  IP="<your-local-IP>"
fi

echo "LAN_IP=$IP"
echo "GATEWAY_URL=ws://${IP}:${PORT}"
echo "Gateway should listen on all interfaces for remote access:"
echo "  GATEWAY_HOST=0.0.0.0 GATEWAY_PORT=${PORT} npm run gateway"
