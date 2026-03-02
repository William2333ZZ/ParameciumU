#!/bin/bash
set -e
export DISPLAY="${DISPLAY:-:99}"

# 1. 虚拟显示（Docker 内无物理显示器，有头模式也画到 :99）
Xvfb "${DISPLAY}" -screen 0 1280x720x24 -ac &
sleep 2

# 2. x11vnc 暴露 :99，noVNC 提供浏览器访问
x11vnc -display "${DISPLAY}" -forever -shared -rfbport 5900 -nopw &
sleep 1
if [[ -x /usr/local/noVNC/utils/novnc_proxy ]]; then
  /usr/local/noVNC/utils/novnc_proxy --vnc localhost:5900 --listen 6080 &
elif command -v websockify &>/dev/null; then
  websockify 6080 localhost:5900 &
fi
sleep 1
echo "noVNC: 浏览器打开 http://<host>:6080/vnc.html 可看桌面与浏览器窗口"

# 3. 有头模式：浏览器窗口会出现在 :99，通过 VNC 可见；节点上报 VNC 端口供 Control UI 代理
export BROWSER_HEADED="${BROWSER_HEADED:-1}"
export VNC_PORT="${VNC_PORT:-6080}"
exec node /app/dist/index.js
