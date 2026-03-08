import OpenAI from "openai";
import type { Context, LLMProvider, Model, StreamEvent, StreamOptions, Tool } from "../types.js";

function toOpenAIMessages(context: Context): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
	const out: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
	if (context.systemPrompt) {
		out.push({ role: "system", content: context.systemPrompt });
	}
	for (const m of context.messages) {
		if (m.role === "user") {
			const content =
				typeof m.content === "string"
					? m.content
					: m.content.map((c) => (c.type === "text" ? c.text : "")).join("");
			out.push({ role: "user", content: content || " " });
		} else if (m.role === "assistant") {
			const content = m.content.map((c) => (c.type === "text" ? c.text : "")).join("");
			const msg: OpenAI.Chat.Completions.ChatCompletionMessageParam = { role: "assistant", content: content || " " };
			if (m.toolCalls?.length) {
				msg.tool_calls = m.toolCalls.map((tc) => ({
					id: tc.id,
					type: "function" as const,
					function: { name: tc.name, arguments: tc.arguments ?? "" },
				}));
			}
			out.push(msg);
		} else if (m.role === "toolResult") {
			const content =
				typeof m.content === "string"
					? m.content
					: m.content.map((c) => (c.type === "text" ? c.text : "")).join("");
			out.push({
				role: "tool",
				tool_call_id: m.toolCallId,
				content: content,
			});
		}
	}
	return out;
}

function toOpenAITools(tools: Tool[]): OpenAI.Chat.Completions.ChatCompletionTool[] {
	return tools.map((t) => ({
		type: "function",
		function: {
			name: t.name,
			description: t.description ?? "",
			parameters: (t.parameters ?? { type: "object", properties: {} }) as Record<string, unknown>,
		},
	}));
}

export function createOpenAIProvider(): LLMProvider {
	return {
		async *stream(model: Model, context: Context, options?: StreamOptions): AsyncIterable<StreamEvent> {
			const apiKey = options?.apiKey ?? (typeof process !== "undefined" && process.env.OPENAI_API_KEY) ?? "";
			if (!apiKey) {
				yield { type: "error", error: new Error("OPENAI_API_KEY or options.apiKey required") };
				return;
			}
			const client = new OpenAI({
				apiKey,
				...(options?.baseURL && { baseURL: options.baseURL }),
			});
			const messages = toOpenAIMessages(context);
			const tools = context.tools?.length ? toOpenAITools(context.tools) : undefined;
			const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
				model: model.id,
				messages,
				stream: true,
				temperature: options?.temperature ?? 0.7,
				max_tokens: options?.maxTokens ?? 4096,
			};
			if (tools) params.tools = tools;
			function isCompleteToolCall(id: string, name: string, args: string): boolean {
				if (!id || !name) return false;
				if (!args || args.trim() === "") return true;
				try {
					JSON.parse(args);
					return true;
				} catch {
					return false;
				}
			}

			try {
				const stream = await client.chat.completions.create(params, {
					signal: options?.signal,
				});
				const contentParts: string[] = [];
				const toolCalls: Map<number, { id: string; name: string; args: string }> = new Map();
				const yieldedToolCallIndices = new Set<number>();
				for await (const chunk of stream) {
					const choice = chunk.choices[0];
					if (!choice?.delta) continue;
					const d = choice.delta;
					if (d.content) {
						contentParts.push(d.content);
						yield { type: "text_delta", delta: d.content };
					}
					if (d.tool_calls) {
						for (const tc of d.tool_calls) {
							const i = tc.index ?? 0;
							let cur = toolCalls.get(i);
							if (!cur) {
								cur = { id: tc.id ?? "", name: tc.function?.name ?? "", args: tc.function?.arguments ?? "" };
								toolCalls.set(i, cur);
							}
							if (tc.id) cur.id = tc.id;
							if (tc.function?.name) cur.name = tc.function.name;
							if (tc.function?.arguments) cur.args += tc.function.arguments;
							if (!yieldedToolCallIndices.has(i) && isCompleteToolCall(cur.id, cur.name, cur.args)) {
								yieldedToolCallIndices.add(i);
								yield { type: "tool_call", id: cur.id, name: cur.name, arguments: cur.args || undefined };
							}
						}
					}
				}
				const sorted = Array.from(toolCalls.entries()).sort((a, b) => a[0] - b[0]);
				for (const [idx, tc] of sorted) {
					if (!yieldedToolCallIndices.has(idx)) {
						yield { type: "tool_call", id: tc.id, name: tc.name, arguments: tc.args || undefined };
					}
				}
				yield {
					type: "done",
					message: {
						role: "assistant",
						content: contentParts.length ? [{ type: "text", text: contentParts.join("") }] : [],
					},
				};
			} catch (err) {
				yield { type: "error", error: err instanceof Error ? err : new Error(String(err)) };
			}
		},
	};
}
