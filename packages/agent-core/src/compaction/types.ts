import type { AgentMessage, AgentState } from "../types.js";

export type SummaryCompleteFn = (context: {
	systemPrompt: string;
	userText: string;
	signal?: AbortSignal;
}) => Promise<string>;

/** Options for when to compact and how much to keep (aligned with OpenClaw-style compaction). */
export interface CompactionSettings {
	/** If false, compaction is skipped. */
	enabled: boolean;
	/** Reserve tokens for response; compact when context > contextWindow - reserveTokens. */
	reserveTokens: number;
	/** Tokens to keep as "recent" messages (the rest are summarized). */
	keepRecentTokens: number;
}

export const DEFAULT_COMPACTION_SETTINGS: CompactionSettings = {
	enabled: true,
	reserveTokens: 16384,
	keepRecentTokens: 20000,
};

export interface CompactionOptions {
	/** Call LLM to generate summary from messages (same model as main agent recommended). */
	completeFn: SummaryCompleteFn;
	/** Model context window (tokens). Used to decide if we should compact. */
	contextWindow: number;
	/** Override defaults. */
	settings?: Partial<CompactionSettings>;
	/** Abort signal for summary request. */
	signal?: AbortSignal;
	/** Optional focus for the summary (e.g. "Focus on decisions and open questions"). */
	customInstructions?: string;
}

export interface CutPointResult {
	/** Messages to summarize (older conversation). */
	toSummarize: AgentMessage[];
	/** Messages to keep as-is (recent). */
	recent: AgentMessage[];
}
