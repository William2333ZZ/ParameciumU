# Short-term memory and multi-turn

## Short-term = in-session state

Within the same process and session, **multi-turn conversation memory** is provided by the agent’s `state.messages`:

- Each call to `runAgentTurnWithTools(state, config, streamFn, userInput, executeTool)` appends the current user input to state, then the model replies and runs tools; the returned **result.state** includes this turn’s user message, assistant reply, and tool results.
- The next turn only needs to pass **the state returned from the previous turn**; the model then sees all prior turns. That is **short-term / multi-turn memory** — no extra storage or tools.

## In practice

- **runMultiTurn(session, ["first", "second", "third"])**: multiple turns in one process; the model sees earlier messages in the same run.
- **runOneTurn**: single turn; state is not retained. If you start a new process each time (e.g. `run.ts "user input"`), there is no short-term memory across runs.

For multi-turn in CLI, run a **long-lived process with a read loop** (e.g. TUI `run-tui.ts`) and reuse the same `state` across turns.

## When to use long-term memory (memory tools)

- User asks “**Last time** we decided…” or “**My** preference is…” and “last time” was a different session → use **memory_search** over MEMORY.md / memory/*.md.
- User says “**Remember** the main points of this conversation” → use **write** or **memory_store** to persist a summary; next run can recall with memory_search.

**Summary:** Multi-turn memory = state.messages (same session). Across sessions = write to memory files + memory_search.
