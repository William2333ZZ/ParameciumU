---
title: "AI OS design sketch"
summary: "Minimal AI OS: file-centric, Agent + cron as main processes, no local UI, connect to Gateway. Same Definition (agent folder)."
read_when:
  - Thinking about “AI-native OS” or long-term direction
  - Considering Rust / RISC-V or similar implementation
---

# Minimal AI OS design sketch

This doc is a **sketch**, not current implementation. It extends the ParameciumU model (“agent = directory, control in Gateway, execution at edge”) to a **minimal AI OS**: what abstractions, what processes, how it connects to the existing Gateway and Control UI, and how a Rust-on-RISC-V style implementation could be layered.

## Why it fits

- **Agent = files** — SOUL, IDENTITY, skills/, memory/, cron/ are files and dirs; one agent = one root path.
- **Skill = file operations** — Read, write, search, list; clear tool boundary, no heavy OS surface.
- **Minimal OS = “files + who runs”** — Storage as filesystem; execution as “agent runner”; no full process model or desktop.

So **OS abstraction = files; Agent abstraction = files.** They align; the agent is a first-class citizen on the OS.

## Target in one sentence

**A headless runtime that only does “filesystem + Agent process + timer,” no local UI, connects to Gateway.** Implementable in Rust targeting RISC-V (bare metal or RISC-V Linux).

## Processes and roles

| Component | Role | Note |
|-----------|------|------|
| **Agent process** | Connect to Gateway; load one agent dir; run turn; execute skills (file I/O); write memory/transcript | Same as current ParameciumU agent; one or more per device, all to same Gateway |
| **Timer (Cron)** | Trigger “run one agent turn” or report to Gateway | Can be in-process (like current ParameciumU) or a tiny daemon |
| **No local UI** | No Control UI, no desktop | All UI remote: browser, Feishu, TUI, via Gateway |

Device role: **Agent box** — filesystem + network to Gateway + these two pieces.

## Filesystem and agent directory

- **Minimal FS** — Dirs, files, path resolution, read/write; in-memory + persist to block, or mount existing FS.
- **Agent dir layout** — Same as ParameciumU Definition so semantics and tooling align: SOUL.md, IDENTITY.md, memory/, knowledge/, skills/, cron/. One path = one agent; runner loads by root path.
- **Skill execution** — Runner parses skill defs (e.g. skills/*/SKILL.md + scripts); tools map to path + read/write/list/search primitives provided by the OS/runtime.

## Relation to Gateway

- Agent process **connects out** to Gateway (WebSocket, like apps/agent): connect(role=agent), receive agent/chat.send/cron, run turn, send back result/stream events.
- Timer at due time: either trigger runner locally and optionally push to Gateway, or rely on Gateway cron to trigger.
- **Protocol** — Same as packages/gateway so Control UI, Feishu, TUI work unchanged with “Agent on AI OS.”

## Rust + RISC-V path (sketch)

- **Language:** Rust for FS, network, runner; no GC, predictable memory.
- **Target:** e.g. riscv64gc-unknown-none-elf (bare) or riscv64gc-unknown-linux-gnu (validate on RISC-V Linux first).
- **Layers (bottom-up):** Boot → minimal FS → network (HTTP/WebSocket to Gateway and LLM API) → Agent runner (load dir, run turn, file tools) → timer.

**Phases:**

1. **Phase 0** — RISC-V Linux userspace: minimal runner + file I/O + WebSocket to Gateway; no kernel work; validate “no UI, Agent + cron, same Gateway” loop.
2. **Phase 1** — Same runner on RISC-V bare metal or unikernel; minimal FS and network; goal: boot, run one turn, connect to Gateway.
3. **Phase 2** — Lock agent dir layout and protocol; optimize size and boot; then multi-agent, multi-device, co-deployment with current ParameciumU.

## Link to current ParameciumU

- **Protocol** — AI OS Agent connects like apps/agent; Control UI / Feishu / TUI stay unchanged.
- **Definition** — The **same** agent dir (SOUL, IDENTITY, skills, cron, memory) can be copied or synced between “ParameciumU on Node” and “AI OS device”: **same paramecium, different runtime.**
- **Gateway** — Runs on your machine or cloud; AI OS device is an edge runner only.

## Summary

| Question | Answer |
|----------|--------|
| What is minimal AI OS? | Filesystem + Agent process (to Gateway) + timer; no local UI |
| Same agent, different box? | Yes; same Definition dir, different runtime (current OS vs AI OS) |
| Relation to this repo? | Protocol and agent dir semantics aligned; ParameciumU on existing OS is the main path; AI OS is an optional long-term shape |

---

_This is a design sketch; it will evolve with discussion and implementation._
