/**
 * Content block for messages (text or image).
 */
export interface TextContent {
	type: "text";
	text: string;
}

export interface ImageContent {
	type: "image";
	data: string;
	mimeType: string;
}

export type ContentBlock = TextContent | ImageContent;

/**
 * Message types for LLM context (aligned with pi-ai concepts).
 */
export interface UserMessage {
	role: "user";
	content: string | ContentBlock[];
}

export interface AssistantMessage {
	role: "assistant";
	content: ContentBlock[];
	/** When present, next toolResult messages are valid (OpenAI: tool must follow assistant with tool_calls). */
	toolCalls?: Array<{ id: string; name: string; arguments?: string }>;
}

export interface SystemMessage {
	role: "system";
	content: string;
}

export interface ToolResultMessage {
	role: "toolResult";
	toolCallId: string;
	toolName?: string;
	content: string | ContentBlock[];
	isError?: boolean;
}

export type Message = UserMessage | AssistantMessage | SystemMessage | ToolResultMessage;

/**
 * Tool definition (name, description, optional JSON schema for parameters).
 */
export interface Tool {
	name: string;
	description?: string;
	parameters?: Record<string, unknown>;
}

/**
 * Tool call emitted by the model.
 */
export interface ToolCall {
	id: string;
	name: string;
	arguments?: string;
}

/**
 * Context passed to stream/complete: system prompt, messages, optional tools.
 */
export interface Context {
	systemPrompt?: string;
	messages: Message[];
	tools?: Tool[];
}

/**
 * Model handle: api (routing key), id, provider (display).
 */
export interface Model {
	api: string;
	id: string;
	provider: string;
}

/**
 * Options for stream/complete.
 */
export interface StreamOptions {
	signal?: AbortSignal;
	apiKey?: string;
	/** Base URL for API (e.g. https://aihubmix.com/v1 for OpenAI-compatible proxies) */
	baseURL?: string;
	temperature?: number;
	maxTokens?: number;
}

/**
 * Stream events yielded by providers (internal); mapped to agent-core StreamChunk in createStreamFn.
 */
export type StreamEvent =
	| { type: "text_delta"; delta: string }
	| { type: "tool_call"; id: string; name: string; arguments?: string }
	| { type: "done"; message?: AssistantMessage }
	| { type: "error"; error: Error };

/**
 * Provider interface: stream(model, context, options) returns async iterable of StreamEvent.
 */
export interface LLMProvider {
	stream(model: Model, context: Context, options?: StreamOptions): AsyncIterable<StreamEvent>;
}
