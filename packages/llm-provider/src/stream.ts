import { getProvider } from "./registry.js";
import type {
	AssistantMessage,
	Context,
	Message,
	Model,
	StreamEvent,
	StreamOptions,
	TextContent,
	Tool,
} from "./types.js";

/**
 * Unified stream: dispatch by model.api, yield StreamEvent.
 */
export async function* stream(model: Model, context: Context, options?: StreamOptions): AsyncIterable<StreamEvent> {
	const provider = getProvider(model.api);
	if (!provider) {
		throw new Error(`No provider registered for api: ${model.api}`);
	}
	yield* provider.stream(model, context, options);
}

/**
 * Complete: consume stream until done, return final AssistantMessage (or throw).
 */
export async function complete(model: Model, context: Context, options?: StreamOptions): Promise<AssistantMessage> {
	let lastMessage: AssistantMessage | undefined;
	for await (const event of stream(model, context, options)) {
		if (event.type === "error") throw event.error;
		if (event.type === "done" && event.message) lastMessage = event.message;
	}
	if (!lastMessage) {
		throw new Error("Stream ended without done message");
	}
	return lastMessage;
}

/**
 * Minimal message shape for adapter (agent-core AgentMessage compatible).
 * When role is "toolResult", toolCallId is required for OpenAI role "tool".
 */
export interface MinimalMessage {
	role: "user" | "assistant" | "system" | "toolResult";
	content: Array<{ type: string; text?: string }>;
	toolCallId?: string;
	isError?: boolean;
	/** When role is "assistant", tool calls so that next toolResult messages are valid. */
	toolCalls?: Array<{ id: string; name: string; arguments?: string }>;
}

/**
 * Minimal tool shape for adapter (agent-core AgentTool compatible).
 */
export interface MinimalTool {
	name: string;
	description?: string;
	parameters?: Record<string, unknown>;
}

/**
 * Chunk shape for agent-core StreamFn (matches agent-core StreamChunk).
 */
export type StreamChunkLike =
	| { type: "text"; text: string }
	| { type: "tool_call"; call: { id: string; name: string; arguments?: string } }
	| { type: "done" };

function toContentBlocks(content: Array<{ type: string; text?: string }>): TextContent[] {
	return content.map((c) => ({ type: "text", text: c.text ?? "" }));
}

function agentMessagesToContext(messages: MinimalMessage[], tools: MinimalTool[]): Context {
	const systemParts: string[] = [];
	const msgs: Message[] = [];
	for (const m of messages) {
		const blocks = toContentBlocks(m.content);
		const text = blocks.map((b) => b.text).join("");
		if (m.role === "system") {
			if (text) systemParts.push(text);
			continue;
		}
		if (m.role === "user") msgs.push({ role: "user", content: blocks });
		else if (m.role === "assistant") {
			const msg: {
				role: "assistant";
				content: typeof blocks;
				toolCalls?: Array<{ id: string; name: string; arguments?: string }>;
			} = { role: "assistant", content: blocks };
			if (m.toolCalls?.length) msg.toolCalls = m.toolCalls;
			msgs.push(msg);
		} else if (m.role === "toolResult" && "toolCallId" in m && m.toolCallId)
			msgs.push({
				role: "toolResult",
				toolCallId: m.toolCallId,
				content: blocks,
				isError: m.isError,
			});
	}
	const systemPrompt = systemParts.length > 0 ? systemParts.join("\n\n") : undefined;
	return { systemPrompt, messages: msgs, tools: tools as Tool[] };
}

/**
 * Create a StreamFn for agent-core: (messages, tools, signal) => AsyncIterable<StreamChunkLike>.
 * Converts AgentMessage[] to Context, calls stream(), maps StreamEvent to StreamChunkLike.
 */
export function createStreamFn(
	model: Model,
	options?: StreamOptions,
): (messages: MinimalMessage[], tools: MinimalTool[], signal?: AbortSignal) => AsyncIterable<StreamChunkLike> {
	return async function* (messages: MinimalMessage[], tools: MinimalTool[], signal?: AbortSignal) {
		const context = agentMessagesToContext(messages, tools);
		const opts = { ...options, signal };
		for await (const event of stream(model, context, opts)) {
			if (event.type === "error") throw event.error;
			// 每个 text_delta 立即 yield，使 agent 的 onTextChunk 能逐段触发，实现流式打字机效果（与 OpenClaw 一致）
			if (event.type === "text_delta") {
				yield { type: "text", text: event.delta } as StreamChunkLike;
			}
			if (event.type === "tool_call") {
				// Normalize arguments: ensure it is valid JSON or undefined.
				// Some models (e.g. MiniMax) may return empty string or non-JSON.
				let normalizedArgs = event.arguments;
				if (normalizedArgs !== undefined) {
					const trimmed = normalizedArgs.trim();
					if (!trimmed || trimmed === "{}") {
						normalizedArgs = undefined;
					} else {
						// Validate JSON; if invalid keep as-is so caller can handle
						try {
							JSON.parse(trimmed);
							normalizedArgs = trimmed;
						} catch {
							// keep original for caller to handle
						}
					}
				}
				yield {
					type: "tool_call",
					call: { id: event.id, name: event.name, arguments: normalizedArgs },
				} as StreamChunkLike;
			}
			if (event.type === "done") {
				yield { type: "done" } as StreamChunkLike;
			}
		}
	};
}
