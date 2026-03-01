#!/usr/bin/env bash
# Print the local machine's LAN IP and the GATEWAY_URL a remote machine should use
# to connect to the local Gateway.
#
# Usage: ./get-local-gateway-url.sh [port]
# Port defaults to 9347 (matches npm run gateway default).
# Can also be set via the GATEWAY_PORT environment variable.

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

echo "Local LAN IP  : $IP"
echo "Gateway port  : $PORT"
echo "Remote should use:"
echo "  GATEWAY_URL=ws://${IP}:${PORT}"
echo ""
echo "Note: start the Gateway bound to all interfaces so the remote can connect:"
echo "  GATEWAY_HOST=0.0.0.0 GATEWAY_PORT=${PORT} npm run gateway"
