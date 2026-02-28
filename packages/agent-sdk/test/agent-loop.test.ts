/**
 * Agent loop unit tests: runOneTurn, runAgentTurn, runAgentTurnWithToolsStreaming
 * with mock streamFn. Aligned with pi-agent agent-loop.test.ts semantics.
 */

import type { AgentMessage, AgentState, ToolCall } from "@monou/agent-core";
import {
	type AgentLoopConfig,
	appendUserMessage,
	createInitialState,
	runOneTurn,
	type StreamFn,
} from "@monou/agent-core";
import { describe, expect, it } from "vitest";
import { createAgent, runAgentTurn, runAgentTurnWithToolsStreaming, type ToolExecutor } from "../src/agent.js";

function textMsg(role: "user" | "assistant" | "system", text: string): AgentMessage {
	return {
		id: "id-" + Math.random().toString(36).slice(2),
		role,
		content: [{ type: "text", text }],
		timestamp: Date.now(),
	};
}

function createMockStreamFn(
	behaviors: Array<{ type: "text"; text: string } | { type: "tool_call"; call: ToolCall } | { type: "done" }>[],
): StreamFn {
	let callIndex = 0;
	return async function* (messages: AgentMessage[], _tools: AgentLoopConfig["tools"], _signal?: AbortSignal) {
		const steps = behaviors[callIndex] ?? [{ type: "done" as const }];
		callIndex++;
		for (const step of steps) {
			if (step.type === "text") yield { type: "text", text: step.text };
			if (step.type === "tool_call") yield { type: "tool_call", call: step.call };
			if (step.type === "done") yield { type: "done" };
		}
	};
}

describe("agent-loop (agent-sdk)", () => {
	it("runAgentTurn returns state and text with mock streamFn", async () => {
		const { state, config, streamFn } = createAgent({
			streamFn: createMockStreamFn([[{ type: "text", text: "Hi there!" }, { type: "done" }]]),
		});
		const result = await runAgentTurn(state, config, streamFn, "Hello");
		expect(result.text).toBe("Hi there!");
		expect(result.state.messages.length).toBe(2);
		expect(result.state.messages[0].role).toBe("user");
		expect(result.state.messages[1].role).toBe("assistant");
	});

	it("apply transformContext before convertToLlm", async () => {
		const state = createInitialState([
			textMsg("user", "old1"),
			textMsg("assistant", "r1"),
			textMsg("user", "old2"),
			textMsg("assistant", "r2"),
		]);
		const stateWithUser = appendUserMessage(state, "new message");
		let transformedLen = 0;
		let convertedLen = 0;
		const config: AgentLoopConfig = {
			convertToLlm: (msgs) => {
				convertedLen = msgs.length;
				return msgs.filter(
					(m) => m.role === "user" || m.role === "assistant" || m.role === "system" || m.role === "toolResult",
				);
			},
			tools: [],
			transformContext: async (messages) => {
				const pruned = messages.slice(-2);
				transformedLen = pruned.length;
				return pruned;
			},
		};
		const streamFn = createMockStreamFn([[{ type: "text", text: "Response" }, { type: "done" }]]);
		const result = await runOneTurn(stateWithUser, config, streamFn);
		expect(transformedLen).toBe(2);
		expect(convertedLen).toBe(2);
		expect(result.text).toBe("Response");
	});

	it("runAgentTurnWithToolsStreaming: tool call then final text", async () => {
		const executed: string[] = [];
		const executeTool: ToolExecutor = async (name, args) => {
			if (name === "echo") executed.push((args.value as string) ?? "");
			return { content: "ok" };
		};
		const streamFn = createMockStreamFn([
			[
				{
					type: "tool_call",
					call: { id: "tc-1", name: "echo", arguments: JSON.stringify({ value: "hello" }) },
				},
				{ type: "done" },
			],
			[{ type: "text", text: "Done." }, { type: "done" }],
		]);
		const { state, config } = createAgent({ streamFn, tools: [{ name: "echo", description: "Echo" }] });
		const result = await runAgentTurnWithToolsStreaming(state, config, streamFn, "echo something", executeTool);
		expect(executed).toEqual(["hello"]);
		expect(result.text).toBe("Done.");
		expect(result.toolCalls.length).toBe(1);
	});

	it("getSteeringMessages: inject after first tool and skip remaining tool calls", async () => {
		const executed: string[] = [];
		const executeTool: ToolExecutor = async (name, args) => {
			if (name === "echo") executed.push((args.value as string) ?? "");
			return { content: "ok" };
		};
		const interrupt = textMsg("user", "interrupt");
		let steeringCallCount = 0;
		const streamFn = createMockStreamFn([
			[
				{
					type: "tool_call",
					call: { id: "t1", name: "echo", arguments: JSON.stringify({ value: "first" }) },
				},
				{
					type: "tool_call",
					call: { id: "t2", name: "echo", arguments: JSON.stringify({ value: "second" }) },
				},
				{ type: "done" },
			],
			[{ type: "text", text: "done" }, { type: "done" }],
		]);
		const config: AgentLoopConfig = {
			convertToLlm: (msgs) =>
				msgs.filter(
					(m) => m.role === "user" || m.role === "assistant" || m.role === "system" || m.role === "toolResult",
				),
			tools: [{ name: "echo", description: "Echo" }],
			getSteeringMessages: async () => {
				steeringCallCount++;
				if (executed.length === 1) return [interrupt];
				return [];
			},
		};
		const state = createInitialState();
		const result = await runAgentTurnWithToolsStreaming(state, config, streamFn, "start", executeTool);
		expect(executed).toEqual(["first"]);
		expect(result.text).toBe("done");
		expect(steeringCallCount).toBeGreaterThanOrEqual(1);
	});

	it("getFollowUpMessages: no tool calls but follow-up queued, then continue", async () => {
		let followUpDelivered = false;
		const streamFn = createMockStreamFn([
			[{ type: "text", text: "First reply." }, { type: "done" }],
			[{ type: "text", text: "Second reply." }, { type: "done" }],
		]);
		const config: AgentLoopConfig = {
			convertToLlm: (msgs) =>
				msgs.filter(
					(m) => m.role === "user" || m.role === "assistant" || m.role === "system" || m.role === "toolResult",
				),
			tools: [],
			getFollowUpMessages: async () => {
				if (!followUpDelivered) {
					followUpDelivered = true;
					return [textMsg("user", "follow-up question")];
				}
				return [];
			},
		};
		const state = createInitialState();
		const result = await runAgentTurnWithToolsStreaming(state, config, streamFn, "hello", async () => ({
			content: "",
		}));
		expect(result.text).toBe("Second reply.");
		expect(followUpDelivered).toBe(true);
	});

	it("createAgent without maxToolRounds has no round limit", async () => {
		let rounds = 0;
		const streamFn = createMockStreamFn([
			[
				{
					type: "tool_call",
					call: { id: "t1", name: "dummy", arguments: "{}" },
				},
				{ type: "done" },
			],
			[
				{
					type: "tool_call",
					call: { id: "t2", name: "dummy", arguments: "{}" },
				},
				{ type: "done" },
			],
			[{ type: "text", text: "end" }, { type: "done" }],
		]);
		const executeTool: ToolExecutor = async () => {
			rounds++;
			return { content: "ok" };
		};
		const { state, config } = createAgent({
			streamFn,
			tools: [{ name: "dummy", description: "Dummy" }],
			// no maxToolRounds
		});
		const result = await runAgentTurnWithToolsStreaming(state, config, streamFn, "go", executeTool);
		expect(rounds).toBe(2);
		expect(result.text).toBe("end");
	});

	it("createAgent with maxToolRounds 1 stops after one tool round", async () => {
		let rounds = 0;
		const streamFn = createMockStreamFn([
			[
				{
					type: "tool_call",
					call: { id: "t1", name: "dummy", arguments: "{}" },
				},
				{ type: "done" },
			],
			[{ type: "text", text: "would be second" }, { type: "done" }],
		]);
		const executeTool: ToolExecutor = async () => {
			rounds++;
			return { content: "ok" };
		};
		const { state, config } = createAgent({
			streamFn,
			tools: [{ name: "dummy", description: "Dummy" }],
			maxToolRounds: 1,
		});
		const result = await runAgentTurnWithToolsStreaming(state, config, streamFn, "go", executeTool);
		expect(rounds).toBe(1);
		expect(result.text).toBe("");
	});
});
