# @monou/llm-provider

Unified LLM API: multi-provider registry, `stream`/`complete`, and `createStreamFn` for agent-core.

## Installation

```bash
npm install @monou/llm-provider
```

## Usage

```ts
import { getModel, stream, complete, createStreamFn, registerBuiltins } from "@monou/llm-provider";

registerBuiltins(); // Registers OpenAI and models: gpt-4o, gpt-4o-mini, gpt-4-turbo

const model = getModel("openai", "gpt-4o");
if (!model) throw new Error("Model not found");

// Stream
for await (const event of stream(model, { messages: [{ role: "user", content: "Hi" }] }, { apiKey: "sk-..." })) {
  if (event.type === "text_delta") process.stdout.write(event.delta);
  if (event.type === "done") break;
}

// Complete
const msg = await complete(model, { messages: [{ role: "user", content: "Hi" }] }, { apiKey: "sk-..." });

// Adapter for agent-core: use as streamFn in createAgent / runAgentTurn
const streamFn = createStreamFn(model, { apiKey: process.env.OPENAI_API_KEY });
// Then: runAgentTurn(state, config, streamFn, "Hello");
```

## Environment

- `OPENAI_API_KEY` used when `options.apiKey` is not set.
