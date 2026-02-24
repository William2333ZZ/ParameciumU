/**
 * Common role names for agent messages.
 */
export type MessageRole = "user" | "assistant" | "system";

/**
 * Base content block (text or future image/attachment).
 */
export interface TextContent {
	type: "text";
	text: string;
}

export type ContentBlock = TextContent;
