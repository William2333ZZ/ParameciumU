# @monou/agent-core

Agent runtime: state management, message types, and one-turn loop abstraction.

## Concepts

- **AgentState**: messages + optional metadata.
- **AgentMessage**: user / assistant / system with content blocks.
- **AgentLoopConfig**: convertToLlm, tools, maxToolRounds.
- **StreamFn**: async generator that yields text and tool_call chunks (implement with your LLM).
- **runOneTurn**: runs one assistant turn via streamFn and returns new state + text + tool calls.

## Usage

```ts
import {
	createInitialState,
	appendUserMessage,
	runOneTurn,
	type AgentLoopConfig,
	type StreamFn,
} from "@monou/agent-core";
```

Implement `StreamFn` with your LLM client; then call `runOneTurn` in a loop, executing tools and appending results between turns.
