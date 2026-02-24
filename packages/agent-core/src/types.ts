import type { ContentBlock } from "@monou/shared";

/**
 * Message in the agent conversation (user, assistant, system, toolResult).
 * When role is "toolResult", toolCallId is required so the LLM can associate the result with the call.
 */
export interface AgentMessage {
	id: string;
	role: "user" | "assistant" | "system" | "toolResult";
	content: ContentBlock[];
	timestamp?: number;
	/** Required when role is "toolResult" (for OpenAI role: "tool" and tool_call_id). */
	toolCallId?: string;
	/** When role is "toolResult", whether the tool execution failed. */
	isError?: boolean;
	/** When role is "assistant", optional tool calls so the next toolResult messages are valid (OpenAI requires tool to follow assistant with tool_calls). */
	toolCalls?: ToolCall[];
}

/**
 * Tool definition: name, description, and optional JSON schema for arguments.
 */
export interface AgentTool {
	name: string;
	description?: string;
	parameters?: Record<string, unknown>;
}

/**
 * Tool call emitted by the model (to be executed and fed back as tool result).
 */
export interface ToolCall {
	id: string;
	name: string;
	arguments?: string;
}

/**
 * Tool result to append to the conversation after executing a tool.
 */
export interface ToolResult {
	toolCallId: string;
	content: string | ContentBlock[];
	isError?: boolean;
}

/**
 * Agent state: messages and optional metadata.
 */
export interface AgentState {
	messages: AgentMessage[];
	metadata?: Record<string, unknown>;
}

/**
 * Configuration for the agent loop (LLM call + tool execution).
 * Aligned with pi-agent-core AgentLoopConfig where applicable; caller provides streamFn.
 */
export interface AgentLoopConfig {
	/** Convert internal AgentMessage[] to the format your LLM expects */
	convertToLlm: (messages: AgentMessage[]) => AgentMessage[] | Promise<AgentMessage[]>;
	/** Tools available to the model */
	tools: AgentTool[];
	/** Max tool call rounds per turn; when omitted, no limit (same as pi). */
	maxToolRounds?: number;
	/**
	 * Optional transform applied before convertToLlm (e.g. pruning, compaction).
	 * Same semantics as pi-agent-core transformContext.
	 */
	transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;
	/**
	 * Called after each tool execution; if messages returned, remaining tool calls are skipped
	 * and these messages are injected before the next LLM call. Same as pi getSteeringMessages.
	 */
	getSteeringMessages?: () => Promise<AgentMessage[]>;
	/**
	 * Called when the agent would stop (no tool calls). If messages returned, they are appended
	 * and the loop continues. Same as pi getFollowUpMessages.
	 */
	getFollowUpMessages?: () => Promise<AgentMessage[]>;
}

/**
 * One chunk from the LLM stream (text or tool call).
 * Your streamFn should yield these; agent-core will collect and run tools.
 */
export type StreamChunk = { type: "text"; text: string } | { type: "tool_call"; call: ToolCall } | { type: "done" };
