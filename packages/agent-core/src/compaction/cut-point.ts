import type { AgentMessage } from "../types.js";
import { estimateTokens } from "./estimate.js";
import type { CutPointResult } from "./types.js";

/**
 * Valid cut points: indices where a "turn" starts so we don't split assistant + tool results.
 * We can cut before: system, user, or at index 0.
 * We must not cut before toolResult (would orphan it).
 */
function getValidCutIndices(messages: AgentMessage[]): number[] {
	const indices: number[] = [0];
	for (let i = 1; i < messages.length; i++) {
		const role = messages[i].role;
		if (role === "system" || role === "user") indices.push(i);
	}
	return indices;
}

/**
 * Find cut point: keep the most recent messages that fit in keepRecentTokens,
 * summarize the rest. Returns toSummarize (older) and recent (kept).
 * Cut only at valid boundaries (user/system) so we never orphan toolResult.
 */
export function findCutPoint(
	messages: AgentMessage[],
	keepRecentTokens: number,
): CutPointResult {
	if (messages.length === 0) {
		return { toSummarize: [], recent: [] };
	}

	const validCuts = getValidCutIndices(messages);
	let accumulated = 0;
	let tentativeEnd = -1; // last index included in "recent" when we hit the token budget

	for (let i = messages.length - 1; i >= 0; i--) {
		accumulated += estimateTokens(messages[i]);
		if (accumulated >= keepRecentTokens) {
			tentativeEnd = i;
			break;
		}
	}

	// cutIndex = largest valid cut <= tentativeEnd (so we don't cut in the middle of a turn)
	const cutIndex =
		tentativeEnd < 0
			? 0
			: Math.max(0, ...validCuts.filter((j) => j <= tentativeEnd), 0);

	const toSummarize = messages.slice(0, cutIndex);
	const recent = messages.slice(cutIndex);
	return { toSummarize, recent };
}
