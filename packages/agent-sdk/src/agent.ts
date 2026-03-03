import type { AgentMessage, AgentTool } from "@monou/agent-core";
import {
	type AgentLoopConfig,
	type AgentState,
	appendMessage,
	appendToolResult,
	appendUserMessage,
	createInitialState,
	prependSystemMessage,
	runOneTurn,
	runOneTurnStreaming,
	type StreamChunk,
	type StreamFn,
	type ToolCall,
} from "@monou/agent-core";
import { formatSkillsForPrompt, loadSkills } from "@monou/skills";

export interface AgentOptions {
	/** Initial messages (optional) */
	initialMessages?: AgentMessage[];
	/** Tools available to the model */
	tools?: AgentTool[];
	/** Custom stream function (LLM); if not provided, a no-op echo stream is used for testing */
	streamFn?: StreamFn;
	/** Max tool rounds per turn */
	maxToolRounds?: number;
	/** System prompt text (prepended before skills if skillDirs set) */
	systemPrompt?: string;
	/** Skill directories or files; loaded and formatted into system prompt (no default dirs) */
	skillDirs?: string[];
}

export interface AgentRunResult {
	state: AgentState;
	text: string;
	toolCalls: ToolCall[];
}

/**
 * Default convertToLlm: pass through user/assistant/system/toolResult messages so the LLM sees tool results.
 */
function defaultConvertToLlm(messages: AgentMessage[]): AgentMessage[] {
	return messages.filter(
		(m) => m.role === "user" || m.role === "assistant" || m.role === "system" || m.role === "toolResult",
	);
}

/**
 * Placeholder stream: echoes last user message. Replace with real LLM in apps.
 */
async function* echoStream(messages: AgentMessage[], _signal?: AbortSignal): AsyncIterable<StreamChunk> {
	const last = messages[messages.length - 1];
	const text =
		last?.role === "user" && last.content[0]?.type === "text"
			? (last.content[0] as { type: "text"; text: string }).text
			: "";
	yield { type: "text", text: `Echo: ${text}` };
	yield { type: "done" };
}

/**
 * Create agent state and config; run one turn with optional streamFn.
 * If systemPrompt or skillDirs are set, a system message is prepended (systemPrompt + formatSkillsForPrompt(skills)).
 */
export function createAgent(options: AgentOptions = {}): {
	state: AgentState;
	config: AgentLoopConfig;
	streamFn: StreamFn;
} {
	let state = createInitialState(options.initialMessages);
	if (options.systemPrompt || (options.skillDirs?.length ?? 0) > 0) {
		const parts: string[] = [];
		if (options.systemPrompt?.trim()) parts.push(options.systemPrompt.trim());
		if (options.skillDirs?.length) {
			const result = loadSkills({ skillPaths: options.skillDirs, includeDefaults: false });
			const skillsBlock = formatSkillsForPrompt(result.skills);
			if (skillsBlock) parts.push(skillsBlock);
		}
		if (parts.length > 0) {
			state = prependSystemMessage(state, parts.join("\n\n"));
		}
	}
	const tools = options.tools ?? [];
	const streamFn =
		options.streamFn ??
		async function* (messages: AgentMessage[]) {
			yield* echoStream(messages);
		};
	const config: AgentLoopConfig = {
		convertToLlm: defaultConvertToLlm,
		tools,
		maxToolRounds: options.maxToolRounds, // undefined = no limit (same as pi)
	};
	return { state, config, streamFn };
}

/**
 * Run one turn: append user message, call runOneTurn, return new state and response.
 */
export async function runAgentTurn(
	state: AgentState,
	config: AgentLoopConfig,
	streamFn: StreamFn,
	userInput: string,
	signal?: AbortSignal,
): Promise<AgentRunResult> {
	const stateWithUser = appendUserMessage(state, userInput);
	const result = await runOneTurn(stateWithUser, config, streamFn, signal);
	return {
		state: result.state,
		text: result.text,
		toolCalls: result.toolCalls,
	};
}

/** 工具执行器：name + args -> content 或 error */
export type ToolExecutor = (
	name: string,
	args: Record<string, unknown>,
) => Promise<{ content: string; isError?: boolean }>;

/**
 * 带工具执行的一轮：先 append 用户输入，再循环 runOneTurn → 若有 toolCalls 则执行并 append 结果，直到无 tool call 或达到 maxToolRounds。
 * 若传 onProgress，每轮工具执行完后会回调本轮消息（assistant+tool_calls 与对应 tool_result），便于上层写 transcript / 推前端。
 */
export async function runAgentTurnWithTools(
	state: AgentState,
	config: AgentLoopConfig,
	streamFn: StreamFn,
	userInput: string,
	executeTool: ToolExecutor,
	signal?: AbortSignal,
	onProgress?: (roundMessages: import("@monou/agent-core").AgentMessage[]) => void | Promise<void>,
): Promise<AgentRunResult> {
	return runAgentTurnWithToolsStreaming(state, config, streamFn, userInput, executeTool, signal, undefined, onProgress);
}

/**
 * 带工具执行的一轮，且支持流式回调：onTextChunk(text) 在每收到一段文本时调用，用于 TUI 逐字展示。
 * onProgress(roundMessages) 在每轮工具执行完后调用，便于上层写 transcript / 推前端，实现「每轮工具完成即落盘、前端可刷新」。
 * 与 pi-agent-core 逻辑对齐：支持 getSteeringMessages（每轮初或每次工具后注入）、getFollowUpMessages（无 toolCalls 时继续）。
 */
export async function runAgentTurnWithToolsStreaming(
	state: AgentState,
	config: AgentLoopConfig,
	streamFn: StreamFn,
	userInput: string,
	executeTool: ToolExecutor,
	signal?: AbortSignal,
	onTextChunk?: (text: string) => void,
	onProgress?: (roundMessages: import("@monou/agent-core").AgentMessage[]) => void | Promise<void>,
): Promise<AgentRunResult> {
	let currentState = appendUserMessage(state, userInput);
	let lastText = "";
	let allToolCalls: ToolCall[] = [];
	const maxRounds = config.maxToolRounds; // undefined = no limit (same as pi)
	let rounds = 0;

	while (true) {
		if (typeof maxRounds === "number" && rounds >= maxRounds) {
			return { state: currentState, text: lastText, toolCalls: allToolCalls };
		}
		// Steering: inject messages at start of round (same as pi pendingMessages)
		const steering = (await config.getSteeringMessages?.()) ?? [];
		if (steering.length > 0) {
			for (const msg of steering) {
				currentState = appendMessage(currentState, msg);
			}
		}

		const result = await runOneTurnStreaming(currentState, config, streamFn, signal, onTextChunk);
		lastText = result.text;
		allToolCalls = [...allToolCalls, ...result.toolCalls];

		if (result.toolCalls.length === 0) {
			// Follow-up: if agent would stop, check for queued follow-up messages (same as pi getFollowUpMessages)
			const followUp = (await config.getFollowUpMessages?.()) ?? [];
			if (followUp.length === 0) {
				return { state: result.state, text: lastText, toolCalls: allToolCalls };
			}
			currentState = result.state;
			for (const msg of followUp) {
				currentState = appendMessage(currentState, msg);
			}
			// Continue loop without incrementing rounds (follow-up is a new logical turn)
			continue;
		}

		let stateWithResults = result.state;
		for (let i = 0; i < result.toolCalls.length; i++) {
			const call = result.toolCalls[i];
			let args: Record<string, unknown> = {};
			if (call.arguments) {
				try {
					args = JSON.parse(call.arguments) as Record<string, unknown>;
				} catch {
					args = { raw: call.arguments };
				}
			}
			const out = await executeTool(call.name, args);
			stateWithResults = appendToolResult(stateWithResults, call.id, out.content, out.isError);
			// Steering after each tool: if user sent new messages, skip remaining tools and inject (same as pi)
			const afterToolSteering = (await config.getSteeringMessages?.()) ?? [];
			if (afterToolSteering.length > 0) {
				// Skip remaining tool calls with a synthetic result so context stays consistent
				for (let j = i + 1; j < result.toolCalls.length; j++) {
					stateWithResults = appendToolResult(
						stateWithResults,
						result.toolCalls[j].id,
						"Skipped due to queued user message.",
						true,
					);
				}
				for (const msg of afterToolSteering) {
					stateWithResults = appendMessage(stateWithResults, msg);
				}
				currentState = stateWithResults;
				break;
			}
		}
		currentState = stateWithResults;
		rounds++;
		// 每轮工具执行完后回调本轮消息（assistant+tool_calls 与对应 tool_result），便于写 transcript / 推前端
		if (onProgress) {
			const roundMessages: import("@monou/agent-core").AgentMessage[] = [
				...result.state.messages.slice(-1),
				...stateWithResults.messages.slice(result.state.messages.length),
			];
			if (roundMessages.length > 0) await Promise.resolve(onProgress(roundMessages));
		}
	}
}
