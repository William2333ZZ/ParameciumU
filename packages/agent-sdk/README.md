# @monou/agent-sdk

High-level agent SDK: create agent state/config, run turns with a pluggable LLM stream function. Supports system prompt and skills (via @monou/skills).

## Usage

```ts
import { createAgent, runAgentTurn } from "@monou/agent-sdk";

const { state, config, streamFn } = createAgent({ tools: [] });
const result = await runAgentTurn(state, config, streamFn, "Hello");
console.log(result.text); // Echo: Hello (placeholder); replace streamFn with real LLM.
```

### System prompt and skills

```ts
const { state, config, streamFn } = createAgent({
  systemPrompt: "You are a helpful assistant.",
  skillDirs: ["./.pi/skills", "./my-skills"],
});
// A system message is prepended: systemPrompt + formatSkillsForPrompt(loadSkills(skillDirs)).
```

Replace `streamFn` in `createAgent` with your LLM client (OpenAI, Anthropic, etc.) to get real completions.

### Using @monou/llm-provider (OpenAI)

```ts
import { createAgent, runAgentTurn } from "@monou/agent-sdk";
import { getModel, createStreamFn, registerBuiltins } from "@monou/llm-provider";

registerBuiltins();
const model = getModel("openai", "gpt-4o");
const streamFn = model ? createStreamFn(model, { apiKey: process.env.OPENAI_API_KEY }) : undefined;

const { state, config, streamFn: fallback } = createAgent({ tools: [], streamFn });
const result = await runAgentTurn(state, config, streamFn ?? fallback, "Hello");
```
