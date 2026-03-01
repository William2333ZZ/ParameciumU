#!/usr/bin/env bash
# Create a new agent directory with the same structure as .first_paramecium.
# Copies SOUL.md, IDENTITY.md, cron/jobs.json, and selected skills from the
# agent-template package (or .first_paramecium as fallback).
#
# Usage:
#   AGENT_DIR=/path/to/new_agent MONOU_ROOT=/path/to/monoU [FROM_TEMPLATE=1] ./create-agent-dir.sh
#
# Environment variables:
#   AGENT_DIR      Absolute path for the new agent directory (required).
#   MONOU_ROOT     monoU repo root; auto-detected from script location if not set.
#   FROM_TEMPLATE  If 1 (default), copy from packages/agent-template/template;
#                  otherwise fall back to .first_paramecium.
#   SKILLS         Space-separated skill names to copy, e.g. "base_skill memory cron".
#                  If empty, copies all skills from the source.

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
  SRC="$MONOU_ROOT/.first_paramecium"
fi

if [ ! -d "$SRC" ]; then
  echo "Source directory not found: $SRC" >&2
  exit 1
fi

# Copy SOUL.md and IDENTITY.md
for f in SOUL.md IDENTITY.md; do
  if [ -f "$SRC/$f" ]; then
    cp "$SRC/$f" "$AGENT_DIR/$f"
    echo "Copied $f"
  fi
done

# Sessions are managed by the Gateway (.gateway/sessions/); no chat.json needed in the agent dir.
# Copy cron/jobs.json (create empty if not present in source)
if [ -f "$SRC/cron/jobs.json" ]; then
  cp "$SRC/cron/jobs.json" "$AGENT_DIR/cron/"
else
  echo '{"version":1,"jobs":[]}' > "$AGENT_DIR/cron/jobs.json"
fi

# Copy skills
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

echo "Agent directory ready: $AGENT_DIR"
