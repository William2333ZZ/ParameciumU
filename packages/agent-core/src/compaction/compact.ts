import type { AgentMessage, AgentState } from "../types.js";
import { findCutPoint } from "./cut-point.js";
import { estimateMessagesTokens } from "./estimate.js";
import { generateSummary } from "./summarize.js";
import { type CompactionOptions, type CompactionSettings, DEFAULT_COMPACTION_SETTINGS } from "./types.js";

const COMPACTION_SUMMARY_PREFIX = "## Context summary (earlier conversation)\n\n";

function createSummarySystemMessage(summary: string): AgentMessage {
	return {
		id: `compaction-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
		role: "system",
		content: [{ type: "text", text: COMPACTION_SUMMARY_PREFIX + summary }],
		timestamp: Date.now(),
	};
}

/**
 * Whether compaction should run: context tokens exceed contextWindow - reserveTokens.
 */
export function shouldCompact(
	messages: AgentMessage[],
	contextWindow: number,
	settings: Partial<CompactionSettings> = {},
): boolean {
	const s = { ...DEFAULT_COMPACTION_SETTINGS, ...settings };
	if (!s.enabled) return false;
	const tokens = estimateMessagesTokens(messages);
	return tokens > contextWindow - s.reserveTokens;
}

/**
 * Compact state: summarize older messages into one system message, keep recent messages.
 * If no compaction is needed, returns the same state.
 * Aligned with OpenClaw: summary persists as part of the message list (system message).
 */
export async function compactState(state: AgentState, options: CompactionOptions): Promise<AgentState> {
	const settings = { ...DEFAULT_COMPACTION_SETTINGS, ...options.settings };
	if (!settings.enabled) return state;
	if (state.messages.length === 0) return state;

	const tokens = estimateMessagesTokens(state.messages);
	if (tokens <= options.contextWindow - settings.reserveTokens) {
		return state;
	}

	const { toSummarize, recent } = findCutPoint(state.messages, settings.keepRecentTokens);
	if (toSummarize.length === 0) return state;

	const summary = await generateSummary(toSummarize, options.completeFn, {
		signal: options.signal,
		customInstructions: options.customInstructions,
	});

	const summaryMessage = createSummarySystemMessage(summary);
	const newMessages: AgentMessage[] = [summaryMessage, ...recent];

	return {
		...state,
		messages: newMessages,
	};
}
