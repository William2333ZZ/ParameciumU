#!/usr/bin/env bash
# 将当前项目同步到远程并启动 Gateway（40005）、Control UI（40006）、Agent、飞书 App
# 用法: ./scripts/deploy-remote.sh
# 会提示输入 SSH 密码（或使用已配置的 SSH 公钥）

set -e
REMOTE="zhanghanhaodi@36.170.54.3"
PORT="46006"
SSH_OPTS="-p $PORT -o StrictHostKeyChecking=accept-new"
RSYNC_OPTS="-avz --exclude=node_modules --exclude=.gateway --exclude=.git"
RSYNC_OPTS="$RSYNC_OPTS --exclude='apps/*/node_modules' --exclude='packages/*/node_modules'"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "=== 1. 同步项目到 $REMOTE (端口 $PORT) ==="
rsync $RSYNC_OPTS -e "ssh $SSH_OPTS" "$ROOT" "${REMOTE}:~/"
echo "同步完成."

echo ""
echo "=== 2. 远程安装 Node 环境（若无）、依赖、构建并启动服务 ==="
ssh $SSH_OPTS "$REMOTE" "bash -s" << 'REMOTE_SCRIPT'
set -e
cd ~/monoU

# 先停止之前启动的 Gateway、Control UI、Agent、飞书 App
if [ -d .gateway ]; then
  for f in gateway.pid control-ui.pid agent.pid feishu-app.pid; do
    [ -f .gateway/$f ] && kill $(cat .gateway/$f) 2>/dev/null || true
  done
fi
pkill -f "node.*apps/gateway/dist/index.js" 2>/dev/null || true
pkill -f "vite preview" 2>/dev/null || true
pkill -f "apps/agent/dist/index.js" 2>/dev/null || true
pkill -f "node.*apps/feishu-app/dist/index.js" 2>/dev/null || true
sleep 1
echo "已停止旧进程（若有）."

# 加载 nvm（若已安装）
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  . "$NVM_DIR/nvm.sh"
fi

# 若无 node 或版本 < 20，则安装 nvm + Node 20
if ! command -v node &>/dev/null || [ "$(node -v 2>/dev/null | sed 's/v//;s/\..*//')" -lt 20 ] 2>/dev/null; then
  echo "未检测到 Node.js >= 20，正在安装 nvm 与 Node 20..."
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    mkdir -p "$NVM_DIR"
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
    . "$NVM_DIR/nvm.sh"
  fi
  nvm install 20
  nvm use 20
fi
export PATH="$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node 2>/dev/null | tail -1)/bin:$PATH" 2>/dev/null || true
echo "Node: $(node -v)  npm: $(npm -v)"

# 若没有 .env，从 env.example 复制一份（可后续在远程编辑）
if [ ! -f .env ] && [ -f env.example ]; then
  cp env.example .env
  echo "已从 env.example 复制 .env，请按需在远程编辑 ~/monoU/.env"
fi

echo "安装依赖..."
npm install
echo "构建..."
npm run build
echo "构建 Control UI..."
npm run control-ui:build 2>/dev/null || (cd apps/control-ui && npm run build)
echo "构建飞书 App..."
(cd apps/feishu-app && npm run build) 2>/dev/null || true
REPO_ROOT="$PWD"
mkdir -p "$REPO_ROOT/.gateway"
echo "启动 Gateway (端口 40005, 监听 0.0.0.0)..."
nohup env GATEWAY_PORT=40005 GATEWAY_HOST=0.0.0.0 node apps/gateway/dist/index.js > "$REPO_ROOT/.gateway/gateway.log" 2>&1 &
echo $! > "$REPO_ROOT/.gateway/gateway.pid"
sleep 2
echo "启动 Agent (连 ws://127.0.0.1:40005，用 tsx 以支持 .ts skill 脚本)..."
nohup env GATEWAY_URL=ws://127.0.0.1:40005 AGENT_ID=.u AGENT_DIR="$REPO_ROOT/.u" npx tsx apps/agent/dist/index.js >> "$REPO_ROOT/.gateway/agent.log" 2>&1 &
echo $! > "$REPO_ROOT/.gateway/agent.pid"
sleep 1
echo "启动 Control UI (端口 40006)..."
nohup bash -c "cd apps/control-ui && exec npx vite preview --port 40006 --host 0.0.0.0" >> "$REPO_ROOT/.gateway/control-ui.log" 2>&1 &
echo $! > "$REPO_ROOT/.gateway/control-ui.pid"
sleep 1
echo "启动飞书 App (GATEWAY_WS_URL=ws://127.0.0.1:40005)..."
nohup env GATEWAY_WS_URL=ws://127.0.0.1:40005 node apps/feishu-app/dist/index.js >> "$REPO_ROOT/.gateway/feishu-app.log" 2>&1 &
echo $! > "$REPO_ROOT/.gateway/feishu-app.pid"
sleep 1
echo ""
echo "已启动:"
echo "  Gateway:    http://36.170.54.3:40005 (WebSocket ws://36.170.54.3:40005)"
echo "  Control UI: http://36.170.54.3:40006"
echo "  Agent:      .u 已连 Gateway（见 .gateway/agent.log）"
echo "  飞书 App:   已连 Gateway（见 .gateway/feishu-app.log；需在 .env 配置 FEISHU_APP_ID/SECRET）"
REMOTE_SCRIPT

echo ""
echo "完成. Gateway、Control UI、Agent、飞书 App 已在远程运行."
