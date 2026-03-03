import type { ContentBlock } from "@monou/shared";
import { createId } from "@monou/shared";
import type { AgentMessage, AgentState } from "./types.js";

/**
 * Create initial agent state.
 */
export function createInitialState(initialMessages?: AgentMessage[]): AgentState {
	return {
		messages: initialMessages ?? [],
		metadata: {},
	};
}

/**
 * Prepend a system message to state (e.g. system prompt + skills).
 */
export function prependSystemMessage(state: AgentState, systemText: string): AgentState {
	const message: AgentMessage = {
		id: createId(),
		role: "system",
		content: [{ type: "text", text: systemText }],
		timestamp: Date.now(),
	};
	return {
		...state,
		messages: [message, ...state.messages],
	};
}

/**
 * Append a user message to state (creates id and timestamp).
 */
export function appendUserMessage(state: AgentState, content: string | ContentBlock[]): AgentState {
	const blocks: ContentBlock[] = typeof content === "string" ? [{ type: "text", text: content }] : content;
	const message: AgentMessage = {
		id: createId(),
		role: "user",
		content: blocks,
		timestamp: Date.now(),
	};
	return {
		...state,
		messages: [...state.messages, message],
	};
}

/**
 * Append an assistant message (e.g. from stream result). When toolCalls are present, they are stored so the next toolResult messages are valid (OpenAI: tool must follow assistant with tool_calls).
 */
export function appendAssistantMessage(
	state: AgentState,
	content: string | ContentBlock[],
	toolCalls?: import("./types.js").ToolCall[],
): AgentState {
	const blocks: ContentBlock[] = typeof content === "string" ? [{ type: "text", text: content }] : content;
	const message: AgentMessage = {
		id: createId(),
		role: "assistant",
		content: blocks,
		timestamp: Date.now(),
		...(toolCalls?.length && { toolCalls }),
	};
	return {
		...state,
		messages: [...state.messages, message],
	};
}

/**
 * Append a tool result to state as a toolResult message.
 * LLM providers (e.g. OpenAI) expect role "tool" with tool_call_id so the model can associate the result with the call.
 */
export function appendToolResult(
	state: AgentState,
	toolCallId: string,
	content: string,
	isError?: boolean,
): AgentState {
	const text = isError ? `[Error] ${content}` : content;
	const message: AgentMessage = {
		id: createId(),
		role: "toolResult",
		content: [{ type: "text", text }],
		timestamp: Date.now(),
		toolCallId,
		isError: isError ?? false,
	};
	return {
		...state,
		messages: [...state.messages, message],
	};
}

/**
 * Append an arbitrary message to state (e.g. for steering/follow-up from getSteeringMessages/getFollowUpMessages).
 * Preserves id/timestamp if present on the message.
 */
export function appendMessage(state: AgentState, message: AgentMessage): AgentState {
	const msg: AgentMessage = {
		...message,
		id: message.id ?? createId(),
		timestamp: message.timestamp ?? Date.now(),
	};
	return {
		...state,
		messages: [...state.messages, msg],
	};
}

/**
 * Remove toolResult messages that are not preceded by an assistant message with a matching tool_call id.
 * When an assistant has multiple tool_calls, tool results appear in a block; we keep each if the nearest
 * preceding assistant contains that tool_call_id, or the previous message is a toolResult we already kept.
 * Prevents OpenAI 400 "tool_call_id did not have response messages".
 */
export function stripOrphanedToolResults(messages: AgentMessage[]): AgentMessage[] {
	const out: AgentMessage[] = [];
	for (let i = 0; i < messages.length; i++) {
		const m = messages[i]!;
		if (m.role !== "toolResult" || !m.toolCallId) {
			out.push(m);
			continue;
		}
		const prev = i > 0 ? messages[i - 1] : undefined;
		const prevIsKeptToolResult = prev?.role === "toolResult" && out[out.length - 1]?.id === prev.id;
		if (prevIsKeptToolResult) {
			out.push(m);
			continue;
		}
		let j = i - 1;
		while (j >= 0 && messages[j]?.role === "toolResult") j--;
		const prevAssistant = j >= 0 && messages[j]?.role === "assistant" ? messages[j] : undefined;
		const prevHasCall = prevAssistant?.toolCalls?.some((tc) => tc.id === m.toolCallId);
		if (prevHasCall) out.push(m);
	}
	return out;
}
