import type { AgentMessage } from "../types.js";

/**
 * Estimate token count for a single message (chars/4 heuristic, conservative).
 * Aligned with OpenClaw/pi compaction behavior.
 */
export function estimateTokens(message: AgentMessage): number {
	let chars = 0;
	if (message.role === "user" || message.role === "assistant" || message.role === "system") {
		for (const block of message.content) {
			if (block.type === "text" && block.text) chars += block.text.length;
		}
		return Math.ceil(chars / 4);
	}
	if (message.role === "toolResult") {
		for (const block of message.content) {
			if (block.type === "text" && block.text) chars += block.text.length;
		}
		return Math.ceil(chars / 4);
	}
	return 0;
}

export function estimateMessagesTokens(messages: AgentMessage[]): number {
	return messages.reduce((sum, m) => sum + estimateTokens(m), 0);
}
