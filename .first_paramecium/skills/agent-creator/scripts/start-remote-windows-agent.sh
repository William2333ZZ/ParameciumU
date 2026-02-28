#!/usr/bin/env bash
# 在远程 Windows 上通过计划任务启动 agent-client，使 SSH 断开后进程仍保留。
#
# 用法:
#   REMOTE_USER=华为 REMOTE_HOST=192.168.213.108 AGENT_ID=win_agent2 \
#   GATEWAY_URL=ws://192.168.211.189:18790 REMOTE_MONOU='C:\Users\华为\monoU' \
#   [SSHPASS=密码] [KILL_FIRST=1] ./.u/skills/agent-creator/scripts/start-remote-windows-agent.sh
#
# 环境变量:
#   REMOTE_USER        远程 SSH 用户名（必填）
#   REMOTE_HOST        远程 IP 或主机名（必填）
#   AGENT_ID           agentId，如 win_agent2（必填）
#   GATEWAY_URL        Gateway 地址（必填）
#   REMOTE_MONOU       远程 monoU 的 Windows 绝对路径，如 C:\Users\华为\monoU（必填）
#   REMOTE_AGENT_DIR   远程 agent 目录；不设则用 REMOTE_MONOU\agents\AGENT_ID
#   SSHPASS            可选，SSH 密码（本机需有 sshpass）
#   KILL_FIRST         可选，设为 1 时先 taskkill /F /IM node.exe 再启动

set -e
REMOTE_USER="${REMOTE_USER:-}"
REMOTE_HOST="${REMOTE_HOST:-}"
AGENT_ID="${AGENT_ID:-}"
GATEWAY_URL="${GATEWAY_URL:-}"
REMOTE_MONOU="${REMOTE_MONOU:-}"
REMOTE_AGENT_DIR="${REMOTE_AGENT_DIR:-}"
KILL_FIRST="${KILL_FIRST:-0}"

if [ -z "$REMOTE_USER" ] || [ -z "$REMOTE_HOST" ] || [ -z "$AGENT_ID" ] || [ -z "$GATEWAY_URL" ] || [ -z "$REMOTE_MONOU" ]; then
  echo "用法: REMOTE_USER=... REMOTE_HOST=... AGENT_ID=... GATEWAY_URL=... REMOTE_MONOU=... $0" >&2
  echo "  REMOTE_MONOU 为远程 monoU 的 Windows 绝对路径，如 C:\\Users\\华为\\monoU" >&2
  echo "  可选: REMOTE_AGENT_DIR=... SSHPASS=... KILL_FIRST=1" >&2
  exit 1
fi

if [ -z "$REMOTE_AGENT_DIR" ]; then
  REMOTE_AGENT_DIR="${REMOTE_MONOU}\\agents\\${AGENT_ID}"
fi

TASK_NAME="MonouAgent_${AGENT_ID}"
# 远程用户主目录下的 monoU 子目录，用于 scp 目标（OpenSSH 下多为 ~/monoU）
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
  echo "MONOU_ROOT 未找到" >&2
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
echo "已生成 .bat: $BAT_PATH"

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

echo "上传 .bat 到远程 ${REMOTE_MONOU_SCP}/..."
run_scp "$BAT_PATH" "${REMOTE_MONOU_SCP}/${BAT_NAME}"

# 计划任务中 .bat 的 Windows 路径（用于 /tr）
WIN_BAT_TR="${REMOTE_MONOU}\\${BAT_NAME}"
echo "创建/覆盖计划任务 ${TASK_NAME}..."
run_ssh "schtasks /create /tn \"${TASK_NAME}\" /tr \"${WIN_BAT_TR}\" /sc once /st 23:59 /sd 2030/01/01 /f"

if [ "$KILL_FIRST" = "1" ]; then
  echo "结束远程已有 node.exe..."
  run_ssh "taskkill /F /IM node.exe 2>nul" || true
fi

echo "运行计划任务..."
run_ssh "schtasks /run /tn \"${TASK_NAME}\""
echo "已触发远程启动；agent 应在数秒内连上 Gateway，Control UI 中可刷新节点列表。"
rm -f "$BAT_PATH"
