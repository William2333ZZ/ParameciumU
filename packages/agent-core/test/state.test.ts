/**
 * State helpers: stripOrphanedToolResults (avoids OpenAI 400 when transcript has orphan toolResult).
 */

import type { AgentMessage } from "@monou/agent-core";
import { stripOrphanedToolResults } from "@monou/agent-core";
import { describe, expect, it } from "vitest";

function msg(
	role: AgentMessage["role"],
	opts?: { toolCalls?: AgentMessage["toolCalls"]; toolCallId?: string },
): AgentMessage {
	return {
		id: `id-${Math.random().toString(36).slice(2, 9)}`,
		role,
		content: [{ type: "text", text: " " }],
		timestamp: Date.now(),
		...(opts?.toolCalls?.length && { toolCalls: opts.toolCalls }),
		...(opts?.toolCallId && { toolCallId: opts.toolCallId }),
	};
}

describe("stripOrphanedToolResults", () => {
	it("keeps toolResult when immediately after assistant with matching tool_call", () => {
		const callId = "call_abc";
		const messages: AgentMessage[] = [
			msg("assistant", { toolCalls: [{ id: callId, name: "foo", arguments: "{}" }] }),
			msg("toolResult", { toolCallId: callId }),
		];
		const out = stripOrphanedToolResults(messages);
		expect(out).toHaveLength(2);
		expect(out[1]!.role).toBe("toolResult");
		expect(out[1]!.toolCallId).toBe(callId);
	});

	it("keeps multiple toolResults after one assistant with multiple tool_calls", () => {
		const callA = "call_A";
		const callB = "call_B";
		const assistantMsg: AgentMessage = {
			id: "ast",
			role: "assistant",
			content: [{ type: "text", text: " " }],
			timestamp: Date.now(),
			toolCalls: [
				{ id: callA, name: "bash", arguments: "{}" },
				{ id: callB, name: "bash", arguments: "{}" },
			],
		};
		const messages: AgentMessage[] = [
			assistantMsg,
			msg("toolResult", { toolCallId: callA }),
			msg("toolResult", { toolCallId: callB }),
		];
		const out = stripOrphanedToolResults(messages);
		expect(out).toHaveLength(3);
		expect(out[1]!.role).toBe("toolResult");
		expect(out[1]!.toolCallId).toBe(callA);
		expect(out[2]!.role).toBe("toolResult");
		expect(out[2]!.toolCallId).toBe(callB);
	});

	it("strips toolResult when immediately after assistant without that tool_call", () => {
		const messages: AgentMessage[] = [
			msg("assistant"), // no toolCalls
			msg("toolResult", { toolCallId: "call_orphan" }),
		];
		const out = stripOrphanedToolResults(messages);
		expect(out).toHaveLength(1);
		expect(out[0]!.role).toBe("assistant");
	});

	it("strips toolResult when after user (no preceding assistant with tool_call)", () => {
		const messages: AgentMessage[] = [msg("user"), msg("toolResult", { toolCallId: "call_xyz" })];
		const out = stripOrphanedToolResults(messages);
		expect(out).toHaveLength(1);
		expect(out[0]!.role).toBe("user");
	});

	it("keeps valid chain and strips orphan in middle of transcript", () => {
		const callId = "call_web";
		const messages: AgentMessage[] = [
			msg("assistant", { toolCalls: [{ id: callId, name: "web_fetch", arguments: "{}" }] }),
			msg("toolResult", { toolCallId: callId }),
			msg("assistant"), // summary, no toolCalls
			msg("assistant"), // duplicate
			msg("user"),
			msg("assistant"),
			msg("toolResult", { toolCallId: callId }), // orphan: prev is assistant without toolCalls
		];
		const out = stripOrphanedToolResults(messages);
		expect(out).toHaveLength(6);
		expect(out.map((m) => m.role)).toEqual([
			"assistant",
			"toolResult",
			"assistant",
			"assistant",
			"user",
			"assistant",
		]);
	});
});
