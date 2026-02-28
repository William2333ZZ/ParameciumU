#!/usr/bin/env bash
# 创建与 .u 同构的 Agent 目录，可从模板复制 SOUL、IDENTITY、必备技能。
# 用法:
#   AGENT_DIR=/path/to/new_agent MONOU_ROOT=/path/to/monoU [FROM_TEMPLATE=1] ./create-agent-dir.sh
# 环境变量:
#   AGENT_DIR     新 Agent 目录绝对路径（必填）
#   MONOU_ROOT    monoU 仓库根目录；用于找 packages/agent-template/template 或 .u（默认脚本向上查找）
#   FROM_TEMPLATE 若为 1，从 packages/agent-template/template 复制；否则从 MONOU_ROOT/.u 复制（缺省 1）
#   SKILLS        要复制的技能名，空格分隔，例如 "base_skill memory cron"（缺省则复制模板全部技能）

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_DIR="${AGENT_DIR:-}"
MONOU_ROOT="${MONOU_ROOT:-}"
FROM_TEMPLATE="${FROM_TEMPLATE:-1}"
SKILLS="${SKILLS:-}"

if [ -z "$AGENT_DIR" ]; then
  echo "AGENT_DIR is required." >&2
  exit 1
fi

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

mkdir -p "$AGENT_DIR"
mkdir -p "$AGENT_DIR/cron"
mkdir -p "$AGENT_DIR/skills"

if [ "$FROM_TEMPLATE" = "1" ] && [ -d "$MONOU_ROOT/packages/agent-template/template" ]; then
  SRC="$MONOU_ROOT/packages/agent-template/template"
else
  SRC="$MONOU_ROOT/.u"
fi

if [ ! -d "$SRC" ]; then
  echo "Source dir not found: $SRC" >&2
  exit 1
fi

# SOUL.md, IDENTITY.md
for f in SOUL.md IDENTITY.md; do
  if [ -f "$SRC/$f" ]; then
    cp "$SRC/$f" "$AGENT_DIR/$f"
    echo "Copied $f"
  fi
done

# 会话由 Gateway 管理（.gateway/sessions/transcripts/），agent 目录不包含 chat.json
# cron/jobs.json
if [ -f "$SRC/cron/jobs.json" ]; then cp "$SRC/cron/jobs.json" "$AGENT_DIR/cron/"; else echo '{"version":1,"jobs":[]}' > "$AGENT_DIR/cron/jobs.json"; fi

# skills
if [ -n "$SKILLS" ]; then
  for s in $SKILLS; do
    if [ -d "$SRC/skills/$s" ]; then
      cp -R "$SRC/skills/$s" "$AGENT_DIR/skills/"
      echo "Copied skill: $s"
    fi
  done
else
  if [ -d "$SRC/skills" ]; then
    for s in "$SRC/skills"/*; do
      [ -d "$s" ] && cp -R "$s" "$AGENT_DIR/skills/" && echo "Copied skill: $(basename "$s")"
    done
  fi
fi

echo "Agent dir ready: $AGENT_DIR"
