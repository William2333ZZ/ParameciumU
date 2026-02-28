# Architecture

This page describes how the main pieces of ParameciumU fit together, as implemented in the codebase.

## Overview

- **Gateway**: WebSocket server. Handles connections (operators, agents, nodes, connectors), sessions, cron RPCs, and forwards “run agent” requests to the connected Agent process. It does **not** run the LLM or store agent personality.
- **Agent process**: Long-lived process that connects to the Gateway with `role: "agent"`, loads one agent directory via `@monou/agent-from-dir`, and runs turns (LLM + tools) when the Gateway sends it work (e.g. via `node.invoke` or internal agent run). Cron jobs are stored in that agent dir; the Agent process runs the cron scheduler and executes due jobs (e.g. Heartbeat).
- **Agent directory**: A folder (e.g. `.first_paramecium`) that defines the agent: `IDENTITY.md`, `SOUL.md`, `MEMORY.md`, `KNOWLEDGE.md`, `skills/`, `cron/jobs.json`. The runtime builds the session and context from this directory; see [Agent directory](./agent-directory.md).

## Data flow

1. **Operator / UI** connects to the Gateway (e.g. Control UI with `role: "client"` or `"operator"`).
2. User sends a message; Gateway resolves the session and the target agent. If the target agent has a connected process, Gateway asks that process to run a turn (message → LLM + tools → response).
3. **Agent process** receives the request, loads the agent dir (if not cached), runs `runAgentTurnWithTools` (from `@monou/agent-sdk`) with tools from `@monou/agent-from-dir` (memory, knowledge, cron, code, todo, web, browser, etc.), and streams the result back.
4. **Gateway** delivers the response to the client and updates session transcript.

Cron: Gateway exposes `cron.*` RPCs; the store for the “default” local agent is under the workspace (e.g. `.first_paramecium/cron/jobs.json`). The Agent process runs `runScheduler` from `@monou/cron` and executes due jobs (e.g. Heartbeat), optionally pushing results to a connector.

## Where things live

| Component | Location | Responsibility |
|-----------|----------|----------------|
| Gateway app | `apps/gateway` | HTTP + WebSocket server, handlers, session store, connector mappings |
| Gateway package | `packages/gateway` | Protocol types, `GATEWAY_METHODS`, `GATEWAY_EVENTS`, client helpers |
| Agent app | `apps/agent` | Connect to Gateway, load agent dir, run turns, cron scheduler |
| Agent-from-dir | `packages/agent-from-dir` | `buildSessionFromU`, `createAgentContextFromU`, load skills and tools from agent dir |
| Agent-template | `packages/agent-template` | Default agent dir layout, `ensureAgentDir`, `getAgentDir`, `getAgentSkillDirs`, `U_BASE_SKILL_NAMES` |
| Agent-core | `packages/agent-core` | Agent state, compaction, message types |
| Agent-sdk | `packages/agent-sdk` | `runAgentTurnWithTools`, createAgent |
| Cron | `packages/cron` | CronStore, job types, schedule computation, scheduler CLI |
| LLM provider | `packages/llm-provider` | OpenAI-compatible stream API, used by agent-from-dir |
| Control UI | `apps/control-ui` | Vite + React app; connects to Gateway over WebSocket |

## Build order

The root `package.json` build script compiles in dependency order: shared → agent-core → skills → cron → agent-sdk → agent-template → llm-provider → agent-from-dir → tui → gateway → apps/gateway → apps/agent. Other apps (control-ui, tui-app, etc.) are built by their own workspaces.
