import { appendAssistantMessage } from "./state.js";
import type { AgentLoopConfig, AgentMessage, AgentState, StreamChunk, ToolCall } from "./types.js";

/**
 * Stream function type: given messages and tools, yields chunks (text / tool_call / done).
 * Implement this with your LLM client (OpenAI, Anthropic, etc.).
 */
export type StreamFn = (
	messages: AgentMessage[],
	tools: AgentLoopConfig["tools"],
	signal?: AbortSignal,
) => AsyncIterable<StreamChunk>;

/**
 * Run one assistant turn: call streamFn, collect text and tool calls.
 * Does NOT execute tools here — returns collected response and tool calls so the caller (or SDK) can execute and loop.
 */
export async function runOneTurn(
	state: AgentState,
	config: AgentLoopConfig,
	streamFn: StreamFn,
	signal?: AbortSignal,
): Promise<{
	state: AgentState;
	text: string;
	toolCalls: ToolCall[];
}> {
	return runOneTurnStreaming(state, config, streamFn, signal);
}

/**
 * Run one assistant turn with optional streaming callback: onTextChunk(text) is called for each text delta.
 */
export async function runOneTurnStreaming(
	state: AgentState,
	config: AgentLoopConfig,
	streamFn: StreamFn,
	signal?: AbortSignal,
	onTextChunk?: (text: string) => void,
): Promise<{
	state: AgentState;
	text: string;
	toolCalls: ToolCall[];
}> {
	let messages = state.messages;
	if (config.transformContext) {
		messages = await config.transformContext(state.messages, signal);
	}
	const llmMessages = await config.convertToLlm(messages);
	const effectiveState: AgentState = messages !== state.messages ? { ...state, messages } : state;
	let currentState = effectiveState;
	let text = "";
	const allToolCalls: ToolCall[] = [];

	for await (const chunk of streamFn(llmMessages, config.tools, signal)) {
		if (chunk.type === "text") {
			text += chunk.text;
			onTextChunk?.(chunk.text);
		}
		if (chunk.type === "tool_call") allToolCalls.push(chunk.call);
	}

	if (text || allToolCalls.length > 0) {
		currentState = appendAssistantMessage(currentState, text || " ", allToolCalls);
	}
	return { state: currentState, text, toolCalls: allToolCalls };
}
