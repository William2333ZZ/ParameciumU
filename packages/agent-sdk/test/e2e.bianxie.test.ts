/**
 * E2E tests using real LLM (Bianxie from .env). Same spirit as pi-agent e2e.test.ts.
 * Load .env from repo root: BIANXIE_API_KEY, BIANXIE_BASE_URL, BIANXIE_MODEL.
 */

import path from "node:path";
import { config } from "dotenv";

// Load .env: try repo root (when cwd is packages/agent-sdk) then cwd
const rootEnv = path.resolve(process.cwd(), "../../.env");
const cwdEnv = path.resolve(process.cwd(), ".env");
config({ path: rootEnv });
config({ path: cwdEnv });

import type { AgentMessage } from "@monou/agent-core";
import { createStreamFn, registerBuiltins } from "@monou/llm-provider";
import { describe, expect, it } from "vitest";
import { createAgent, runAgentTurnWithTools } from "../src/agent";

const BIANXIE_API_KEY = process.env.BIANXIE_API_KEY;
const BIANXIE_BASE_URL = process.env.BIANXIE_BASE_URL;
const BIANXIE_MODEL = process.env.BIANXIE_MODEL || "gpt-4o-mini";

function toMinimalMessages(messages: AgentMessage[]) {
	return messages.map((m) => {
		const content = m.content.map((c) =>
			c.type === "text" ? { type: "text" as const, text: c.text } : { type: c.type, text: "" },
		);
		const out: {
			role: AgentMessage["role"];
			content: Array<{ type: string; text?: string }>;
			toolCallId?: string;
			isError?: boolean;
			toolCalls?: Array<{ id: string; name: string; arguments?: string }>;
		} = { role: m.role, content };
		if (m.role === "toolResult") {
			if (m.toolCallId) out.toolCallId = m.toolCallId;
			if (m.isError !== undefined) out.isError = m.isError;
		}
		if (m.role === "assistant" && m.toolCalls?.length) out.toolCalls = m.toolCalls;
		return out;
	});
}

function createBianxieStreamFn() {
	registerBuiltins();
	const apiKey = BIANXIE_API_KEY ?? "";
	const baseURL = BIANXIE_BASE_URL || undefined;
	const llmStreamFn = createStreamFn(
		{ api: "openai" as const, id: BIANXIE_MODEL, provider: "openai" },
		{ apiKey, baseURL },
	);
	return async function* (
		messages: AgentMessage[],
		tools: Parameters<typeof llmStreamFn>[1],
		signal?: AbortSignal,
	): AsyncIterable<
		| { type: "text"; text: string }
		| { type: "tool_call"; call: { id: string; name: string; arguments?: string } }
		| { type: "done" }
	> {
		for await (const chunk of llmStreamFn(toMinimalMessages(messages), tools, signal)) {
			yield chunk as
				| { type: "text"; text: string }
				| { type: "tool_call"; call: { id: string; name: string; arguments?: string } }
				| { type: "done" };
		}
	};
}

/** Simple calculator: executeTool(name, args) returns { content, isError? } */
function makeCalculateExecutor(): (
	name: string,
	args: Record<string, unknown>,
) => Promise<{ content: string; isError?: boolean }> {
	return async (name: string, args: Record<string, unknown>) => {
		if (name !== "calculate") return { content: `Unknown tool: ${name}`, isError: true };
		const expression = typeof args.expression === "string" ? args.expression : String(args.expression ?? "");
		try {
			// eslint-disable-next-line no-new-func
			const result = new Function(`return ${expression}`)();
			return { content: `${expression} = ${result}` };
		} catch (e) {
			return { content: (e as Error).message || String(e), isError: true };
		}
	};
}

describe("e2e bianxie", () => {
	const hasKey = Boolean(BIANXIE_API_KEY);

	it("basic prompt: 2+2 (no tools)", async () => {
		if (!hasKey) {
			console.warn("Skip e2e: BIANXIE_API_KEY not set");
			return;
		}
		const streamFn = createBianxieStreamFn();
		const {
			state,
			config,
			streamFn: sf,
		} = createAgent({
			systemPrompt: "You are a helpful assistant. Keep your responses concise.",
			tools: [],
			streamFn,
		});

		const result = await runAgentTurnWithTools(
			state,
			config,
			sf,
			"What is 2+2? Answer with just the number.",
			makeCalculateExecutor(),
		);

		expect(result.state.messages.length).toBeGreaterThanOrEqual(2);
		expect(result.state.messages.some((m) => m.role === "user")).toBe(true);
		const last = result.state.messages[result.state.messages.length - 1];
		expect(last.role).toBe("assistant");
		const text = last.content?.find((c) => c.type === "text");
		expect(text).toBeDefined();
		if (text && text.type === "text") {
			expect(text.text).toContain("4");
		}
	}, 30_000);

	it("tool execution: 123 * 456 via calculate", async () => {
		if (!hasKey) {
			console.warn("Skip e2e: BIANXIE_API_KEY not set");
			return;
		}
		const streamFn = createBianxieStreamFn();
		const tools = [
			{
				name: "calculate",
				description: "Evaluate a mathematical expression. Example: calculate(expression: '2+2')",
				parameters: {
					type: "object",
					properties: { expression: { type: "string", description: "The expression to evaluate" } },
					required: ["expression"],
				} as Record<string, unknown>,
			},
		];
		const {
			state,
			config,
			streamFn: sf,
		} = createAgent({
			systemPrompt: "You are a helpful assistant. Always use the calculate tool for math.",
			tools,
			streamFn,
		});

		const result = await runAgentTurnWithTools(
			state,
			config,
			sf,
			"Calculate 123 * 456 using the calculator tool.",
			makeCalculateExecutor(),
		);

		expect(result.state.messages.length).toBeGreaterThanOrEqual(3);
		const toolResultMsg = result.state.messages.find((m) => m.role === "toolResult");
		expect(toolResultMsg).toBeDefined();
		const toolText = toolResultMsg?.content?.find((c) => c.type === "text");
		expect(toolText).toBeDefined();
		if (toolText && toolText.type === "text") {
			expect(toolText.text).toContain("56088");
		}
		const last = result.state.messages[result.state.messages.length - 1];
		expect(last.role).toBe("assistant");
		const lastText = last.content?.find((c) => c.type === "text");
		if (lastText && lastText.type === "text") {
			expect(lastText.text.includes("56088") || lastText.text.includes("56,088")).toBe(true);
		}
	}, 45_000);
});
