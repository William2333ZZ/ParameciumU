#!/usr/bin/env bash
# Create a new agent directory from template/current agent source.
#
# Usage:
#   AGENT_DIR=/abs/path/to/agents/my_agent MONOU_ROOT=/path/to/monoU \
#   [FROM_TEMPLATE=1] [SKILLS="base_skill memory cron"] \
#   .first_paramecium/skills/agent-creator/scripts/create-agent-dir.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_DIR="${AGENT_DIR:-}"
MONOU_ROOT="${MONOU_ROOT:-}"
FROM_TEMPLATE="${FROM_TEMPLATE:-1}"
SKILLS="${SKILLS:-}"
CURRENT_AGENT_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"

if [ -z "$AGENT_DIR" ]; then
  echo "AGENT_DIR is required." >&2
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
  echo "Failed to locate MONOU_ROOT." >&2
  exit 1
fi

if [ "$FROM_TEMPLATE" = "1" ] && [ -d "$MONOU_ROOT/packages/agent-template/template" ]; then
  SRC="$MONOU_ROOT/packages/agent-template/template"
else
  SRC="$MONOU_ROOT/.first_paramecium"
fi

if [ ! -d "$SRC" ]; then
  echo "Source directory not found: $SRC" >&2
  exit 1
fi

mkdir -p "$AGENT_DIR/cron" "$AGENT_DIR/skills"

for f in SOUL.md IDENTITY.md KNOWLEDGE.md MEMORY.md; do
  if [ -f "$SRC/$f" ]; then
    cp "$SRC/$f" "$AGENT_DIR/$f"
  fi
done

if [ -f "$SRC/llm.json" ]; then
  cp "$SRC/llm.json" "$AGENT_DIR/llm.json"
elif [ -f "$CURRENT_AGENT_DIR/llm.json" ]; then
  # 模板通常只有 llm.json.example；优先继承当前运行 agent 的 llm.json，避免新 agent 因缺 apiKey 无法启动
  cp "$CURRENT_AGENT_DIR/llm.json" "$AGENT_DIR/llm.json"
elif [ -f "$SRC/llm.json.example" ]; then
  cp "$SRC/llm.json.example" "$AGENT_DIR/llm.json.example"
fi

if [ -f "$SRC/cron/jobs.json" ]; then
  cp "$SRC/cron/jobs.json" "$AGENT_DIR/cron/jobs.json"
else
  echo '{"version":1,"jobs":[]}' > "$AGENT_DIR/cron/jobs.json"
fi

if [ -n "$SKILLS" ]; then
  for s in $SKILLS; do
    if [ -d "$SRC/skills/$s" ]; then
      rm -rf "$AGENT_DIR/skills/$s"
      cp -R "$SRC/skills/$s" "$AGENT_DIR/skills/"
      echo "Copied skill: $s"
    else
      echo "Skip missing skill: $s" >&2
    fi
  done
else
  if [ -d "$SRC/skills" ]; then
    for s in "$SRC/skills"/*; do
      [ -d "$s" ] || continue
      bn="$(basename "$s")"
      rm -rf "$AGENT_DIR/skills/$bn"
      cp -R "$s" "$AGENT_DIR/skills/"
      echo "Copied skill: $bn"
    done
  fi
fi

echo "Agent directory ready: $AGENT_DIR"
