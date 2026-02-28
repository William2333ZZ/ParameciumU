/**
 * Compaction tests (ported from @monou/compaction). Tests shouldCompact, findCutPoint, compactState with mock completeFn.
 */

import type { AgentMessage, AgentState } from "@monou/agent-core";
import { compactState, estimateMessagesTokens, findCutPoint, shouldCompact } from "@monou/agent-core";
import { describe, expect, it } from "vitest";

function textMsg(role: "user" | "assistant" | "system", text: string): AgentMessage {
	return {
		id: `id-${Math.random().toString(36).slice(2, 9)}`,
		role,
		content: [{ type: "text", text }],
		timestamp: Date.now(),
	};
}

describe("compaction", () => {
	describe("shouldCompact", () => {
		it("returns false when enabled is false", () => {
			const messages = [textMsg("user", "x".repeat(100000))];
			expect(shouldCompact(messages, 128000, { enabled: false })).toBe(false);
		});

		it("returns false when tokens within limit", () => {
			const messages = [textMsg("user", "short"), textMsg("assistant", "short reply")];
			expect(shouldCompact(messages, 128000)).toBe(false);
		});

		it("returns true when tokens exceed contextWindow - reserveTokens", () => {
			const big = "x".repeat(500000);
			const messages = [textMsg("user", big)];
			expect(shouldCompact(messages, 128000)).toBe(true);
		});
	});

	describe("findCutPoint", () => {
		it("returns all as recent when under keepRecentTokens", () => {
			const messages = [textMsg("user", "hello"), textMsg("assistant", "hi")];
			const { toSummarize, recent } = findCutPoint(messages, 20000);
			expect(toSummarize).toHaveLength(0);
			expect(recent).toHaveLength(2);
		});

		it("splits toSummarize and recent by keepRecentTokens", () => {
			const messages = [
				textMsg("user", "a".repeat(40000)),
				textMsg("assistant", "b".repeat(40000)),
				textMsg("user", "c".repeat(40000)),
				textMsg("assistant", "d".repeat(40000)),
			];
			const { toSummarize, recent } = findCutPoint(messages, 15000);
			expect(toSummarize.length).toBeGreaterThan(0);
			expect(recent.length).toBeGreaterThan(0);
			expect(toSummarize.length + recent.length).toBe(messages.length);
		});

		it("does not cut before toolResult", () => {
			const messages: AgentMessage[] = [
				textMsg("user", "run tool"),
				textMsg("assistant", "ok"),
				{
					id: "t1",
					role: "toolResult",
					content: [{ type: "text", text: "result" }],
					timestamp: Date.now(),
					toolCallId: "call-1",
				},
				textMsg("user", "thanks"),
			];
			const { toSummarize, recent } = findCutPoint(messages, 1);
			expect(recent.length).toBeGreaterThan(0);
			expect(toSummarize.length + recent.length).toBe(messages.length);
		});
	});

	describe("compactState", () => {
		it("returns same state when no compaction needed", async () => {
			const state: AgentState = {
				messages: [textMsg("user", "hi"), textMsg("assistant", "hello")],
			};
			const completeFn = async () => "";
			const result = await compactState(state, {
				completeFn,
				contextWindow: 128000,
			});
			expect(result).toBe(state);
			expect(result.messages).toHaveLength(2);
		});

		it("returns same state when enabled is false", async () => {
			const state: AgentState = {
				messages: [textMsg("user", "x".repeat(500000))],
			};
			const completeFn = async () => "summary";
			const result = await compactState(state, {
				completeFn,
				contextWindow: 128000,
				settings: { enabled: false },
			});
			expect(result).toBe(state);
		});

		it("produces summary system message + recent when compaction runs", async () => {
			const old1 = textMsg("user", "a".repeat(40000));
			const old2 = textMsg("assistant", "b".repeat(40000));
			const recent1 = textMsg("user", "c".repeat(40000));
			const recent2 = textMsg("assistant", "recent reply");
			const state: AgentState = {
				messages: [old1, old2, recent1, recent2],
			};
			const completeFn = async () => "Summary of older conversation.";
			const result = await compactState(state, {
				completeFn,
				contextWindow: 10000,
				settings: { reserveTokens: 1000, keepRecentTokens: 500 },
			});
			expect(result.messages.length).toBeLessThanOrEqual(state.messages.length + 1);
			const systemMsg = result.messages.find((m) => m.role === "system");
			expect(systemMsg).toBeDefined();
			const text = systemMsg!.content?.find((c) => c.type === "text");
			expect(text && text.type === "text" ? text.text : "").toContain("Summary of older conversation.");
			expect(
				result.messages.some(
					(m) => m.role === "assistant" && (m.content[0] as { text?: string })?.text === "recent reply",
				),
			).toBe(true);
		});
	});

	describe("estimateMessagesTokens", () => {
		it("estimates tokens from text content", () => {
			const messages = [textMsg("user", "hello world"), textMsg("assistant", "hi")];
			const t = estimateMessagesTokens(messages);
			expect(t).toBeGreaterThan(0);
			expect(t).toBeLessThan(10);
		});
	});
});
