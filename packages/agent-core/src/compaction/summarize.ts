import type { AgentMessage } from "../types.js";
import type { SummaryCompleteFn } from "./types.js";

const SUMMARIZATION_SYSTEM = `You are a summarization assistant. Summarize the conversation precisely so another LLM can continue the work. Preserve: goals, decisions, key facts, file paths, and next steps. Output only the summary, no preamble.`;

const SUMMARIZATION_PROMPT = `The messages below are a conversation to summarize. Create a structured context checkpoint that another LLM will use to continue.

Use this format:

## Goal
[What the user is trying to accomplish]

## Key decisions and facts
- [Decision or fact]: [brief rationale or detail]

## Progress
- Done: [completed items]
- In progress / next: [current or next steps]

## Critical context
- [Paths, names, errors, or references to keep]

Keep each section concise. Preserve exact file paths and important names.`;

function serializeMessage(m: AgentMessage): string {
	const role = m.role;
	let text = "";
	for (const block of m.content) {
		if (block.type === "text" && block.text) text += block.text;
	}
	if (!text.trim()) return `[${role}] (no text)`;
	return `[${role}]\n${text.trim()}`;
}

function serializeConversation(messages: AgentMessage[]): string {
	return messages.map(serializeMessage).join("\n\n---\n\n");
}

/**
 * Generate a summary of the given messages using the provided LLM complete function.
 */
export async function generateSummary(
	messages: AgentMessage[],
	completeFn: SummaryCompleteFn,
	opts?: { signal?: AbortSignal; customInstructions?: string },
): Promise<string> {
	if (messages.length === 0) return "No prior conversation.";

	const conversationText = serializeConversation(messages);
	let userText = `<conversation>\n${conversationText}\n</conversation>\n\n${SUMMARIZATION_PROMPT}`;
	if (opts?.customInstructions?.trim()) {
		userText += `\n\nAdditional focus: ${opts.customInstructions.trim()}`;
	}

	const summary = await completeFn({
		systemPrompt: SUMMARIZATION_SYSTEM,
		userText,
		signal: opts?.signal,
	});
	return summary?.trim() || "No prior conversation.";
}
