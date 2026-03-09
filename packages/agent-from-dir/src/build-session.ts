/**
 * 从传入的 agent 目录构建 AgentSession 与 createAgentContextFromU。
 * 无默认目录：调用方通过 AGENT_DIR 传入 agent 目录；该目录下的 llm.json 控制模型，SOUL.md/IDENTITY.md 定义身份。
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { AgentLoopConfig, AgentMessage, AgentState, AgentTool, StreamChunk, StreamFn } from "@monou/agent-core";
import { type CompactionSettings, compactState, shouldCompact } from "@monou/agent-core";
import { createAgent, runAgentTurnWithTools } from "@monou/agent-sdk";
import { ensureAgentDir, getAgentSkillDirs, U_BASE_SKILL_NAMES } from "@monou/agent-template";
import { complete, createStreamFn, registerBuiltins } from "@monou/llm-provider";
import { createSkillScriptExecutor, loadSkillScriptTools } from "./load-skill-script-tools.js";

const LOG_PREFIX = "[agent-from-dir]";

export interface AgentSession {
	agentDir: string;
	skillDirs: string[];
	mergedTools: AgentTool[];
	executeTool: (name: string, args: Record<string, unknown>) => Promise<{ content: string; isError?: boolean }>;
}

export type GatewayInvoke = (method: string, params: Record<string, unknown>) => Promise<unknown>;

type SkillExecuteTool = (
	name: string,
	args: Record<string, unknown>,
	gatewayInvoke?: GatewayInvoke,
) => Promise<{ content: string; isError?: boolean }>;

export interface BuildSessionFromUOptions {
	/** Agent 目录路径（运行时由 AGENT_DIR 传入；无默认值，调用方必须指定）。该目录下的 llm.json 在 createAgentContextFromU 中用于模型配置。 */
	agentDir?: string;
	gatewayInvoke?: GatewayInvoke;
	/** When true, use agentDir as-is without ensureAgentDir (for tests with minimal fixture). */
	skipEnsureAgentDir?: boolean;
}

/**
 * 从传入的 agent 目录构建 Session（skills、tools、executeTool）。
 * 调用方应传入 opts.agentDir（如 process.env.AGENT_DIR）；无默认目录。模型由该目录的 llm.json 在 createAgentContextFromU 时加载。
 */
export async function buildSessionFromU(
	rootDir: string = process.cwd(),
	opts?: BuildSessionFromUOptions,
): Promise<AgentSession> {
	const agentDir =
		opts?.skipEnsureAgentDir && opts?.agentDir != null
			? path.resolve(opts.agentDir)
			: opts?.agentDir != null
				? ensureAgentDir({ agentDir: opts.agentDir })
				: ensureAgentDir({ rootDir });
	console.info(`${LOG_PREFIX} buildSessionFromU agentDir=${agentDir}`);
	const baseSkillDirs = getAgentSkillDirs(agentDir, { asAgentDir: true }).filter((d) =>
		existsSync(path.join(d, "SKILL.md")),
	);
	const skillsRoot = path.join(agentDir, "skills");
	const discovered = existsSync(skillsRoot)
		? readdirSync(skillsRoot, { withFileTypes: true })
				.filter((d) => d.isDirectory() && existsSync(path.join(skillsRoot, d.name, "SKILL.md")))
				.map((d) => path.join(skillsRoot, d.name))
		: [];
	const otherDirs = discovered.filter(
		(d) => !U_BASE_SKILL_NAMES.includes(path.basename(d) as (typeof U_BASE_SKILL_NAMES)[number]),
	);
	const skillDirs = [...baseSkillDirs, ...otherDirs];

	function toolsPathFromSkillDir(skillDir: string): string | null {
		const dir = path.join(skillDir, "scripts");
		const js = path.join(dir, "tools.js");
		const ts = path.join(dir, "tools.ts");
		if (existsSync(js)) return js;
		if (existsSync(ts)) return ts;
		return null;
	}
	const noopSkill = (): { tools: AgentTool[]; executeTool: SkillExecuteTool } => ({
		tools: [],
		executeTool: async () => ({ content: "skill not loaded", isError: true }),
	});
	const loadSkillModule = async (scriptPath: string | null): Promise<{ tools: AgentTool[]; executeTool: SkillExecuteTool }> => {
		if (!scriptPath) return noopSkill();
		try {
			const mod = await import(pathToFileURL(scriptPath).href);
			return {
				tools: (mod.tools ?? []) as AgentTool[],
				executeTool: (mod.executeTool ?? noopSkill().executeTool) as SkillExecuteTool,
			};
		} catch (err) {
			console.warn(`${LOG_PREFIX} loadSkillModule 失败 path=${scriptPath}`, err);
			return noopSkill();
		}
	};
	const skillModuleCache = new Map<string, Promise<{ tools: AgentTool[]; executeTool: SkillExecuteTool }>>();
	const loadSkillModuleByDir = (skillDir: string): Promise<{ tools: AgentTool[]; executeTool: SkillExecuteTool }> => {
		const key = path.resolve(skillDir);
		const cached = skillModuleCache.get(key);
		if (cached) return cached;
		const p = loadSkillModule(toolsPathFromSkillDir(key));
		skillModuleCache.set(key, p);
		return p;
	};

	/** 按 skillDirs 顺序动态加载所有带 scripts/tools.js 或 tools.ts 的 skill */
	const loadedSkills: { skillName: string; skillDir: string; tools: AgentTool[] }[] = [];
	const toolToSkill = new Map<string, { skillName: string; skillDir: string }>();
	const skillNameToDir = new Map<string, string>();
	for (const skillDir of skillDirs) {
		const skillName = path.basename(skillDir);
		skillNameToDir.set(skillName, skillDir);
		const mod = await loadSkillModuleByDir(skillDir);
		if (mod.tools.length === 0) continue;
		loadedSkills.push({ skillName, skillDir, tools: mod.tools });
		for (const t of mod.tools) {
			toolToSkill.set(t.name, { skillName, skillDir });
		}
	}
	console.info(`${LOG_PREFIX} skills(提示词): ${skillDirs.map((d) => path.basename(d)).join(", ") || "(无)"}`);
	console.info(`${LOG_PREFIX} skills(动态加载tools): ${loadedSkills.map((s) => s.skillName).join(", ") || "(无)"}`);

	const baseSkillDir = skillNameToDir.get("base_skill");
	const knowledgeSkillDir = skillNameToDir.get("knowledge");

	const { tools: scriptTools, entries: scriptEntries } = loadSkillScriptTools(skillDirs, {
		excludeDirNames: loadedSkills.map((s) => s.skillName),
	});
	const executeSkillScript = createSkillScriptExecutor(scriptEntries);

	const knowledgeTopicTools: AgentTool[] = [];
	if (existsSync(skillsRoot) && knowledgeSkillDir) {
		const dirs = readdirSync(skillsRoot, { withFileTypes: true });
		for (const d of dirs) {
			if (!d.isDirectory() || !d.name.endsWith("_knowledge")) continue;
			const skillDir = path.join(skillsRoot, d.name);
			if (!existsSync(path.join(skillDir, "SKILL.md"))) continue;
			let topic = d.name.slice(0, -"_knowledge".length);
			const topicJsonPath = path.join(skillDir, "topic.json");
			if (existsSync(topicJsonPath)) {
				try {
					const raw = readFileSync(topicJsonPath, "utf-8");
					const data = JSON.parse(raw) as { topic?: string };
					if (typeof data?.topic === "string" && data.topic.trim()) topic = data.topic.trim();
				} catch {
					// keep topic from dir name
				}
			}
			const toolName = `${topic}_knowledge_search`;
			knowledgeTopicTools.push({
				name: toolName,
				description: `仅在「${topic}」主题知识库中搜索。用于该领域相关问题。`,
				parameters: {
					type: "object",
					properties: {
						query: { type: "string", description: "搜索词或短语" },
						maxResults: { type: "number", description: "最多返回条数，默认 10" },
					},
					required: ["query"],
				},
			});
			toolToSkill.set(toolName, { skillName: "knowledge", skillDir: knowledgeSkillDir });
		}
	}

	const mergedTools: AgentTool[] = [];
	for (const skillDir of skillDirs) {
		const loaded = loadedSkills.find((s) => s.skillDir === skillDir);
		if (loaded) mergedTools.push(...loaded.tools);
	}
	mergedTools.push(...scriptTools, ...knowledgeTopicTools);

	const scriptToolNames = new Set(scriptEntries.map((e) => e.name));
	const gatewayInvoke = opts?.gatewayInvoke;

	async function executeTool(
		name: string,
		args: Record<string, unknown>,
	): Promise<{ content: string; isError?: boolean }> {
		const skill = toolToSkill.get(name);
		if (skill) {
			const mod = await loadSkillModuleByDir(skill.skillDir);
			if (skill.skillName === "knowledge" && name.endsWith("_knowledge_search")) {
				const topic = name.slice(0, -"_knowledge_search".length);
				return mod.executeTool("knowledge_search", {
					query: args?.query,
					topic,
					maxResults: args?.maxResults,
				}, gatewayInvoke);
			}
			return mod.executeTool(name, args, gatewayInvoke);
		}
		if (scriptToolNames.has(name)) return executeSkillScript(name, args);
		if (baseSkillDir) {
			const base = await loadSkillModuleByDir(baseSkillDir);
			return base.executeTool(name, args, gatewayInvoke);
		}
		return noopSkill().executeTool(name, args, gatewayInvoke);
	}
	console.info(`${LOG_PREFIX} buildSessionFromU 完成 agentDir=${agentDir} skillDirs=${skillDirs.length} tools=${mergedTools.length}`);
	return { agentDir, skillDirs, mergedTools, executeTool };
}

function toMinimalMessages(messages: AgentMessage[]) {
	return messages.map((m) => {
		const content = m.content.map((c) =>
			c.type === "text" ? { type: "text" as const, text: c.text } : { type: c.type, text: "" },
		);
		const out: {
			role: AgentMessage["role"];
			content: Array<{ type: string; text?: string }>;
			toolCallId?: string;
			isError?: boolean;
			toolCalls?: Array<{ id: string; name: string; arguments?: string }>;
		} = { role: m.role, content };
		if (m.role === "toolResult") {
			if (m.toolCallId) out.toolCallId = m.toolCallId;
			if (m.isError !== undefined) out.isError = m.isError;
		}
		if (m.role === "assistant" && m.toolCalls?.length) out.toolCalls = m.toolCalls;
		return out;
	});
}

function readSoulAndIdentity(agentDir: string): string {
	const parts: string[] = [];
	const soulPath = path.join(agentDir, "SOUL.md");
	const identityPath = path.join(agentDir, "IDENTITY.md");
	if (existsSync(soulPath)) {
		try {
			parts.push("## 你的 SOUL（原则与边界）\n\n" + readFileSync(soulPath, "utf-8"));
		} catch {
			// ignore
		}
	}
	if (existsSync(identityPath)) {
		try {
			parts.push("## 你的 IDENTITY（身份档案）\n\n" + readFileSync(identityPath, "utf-8"));
		} catch {
			// ignore
		}
	}
	return parts.length ? parts.join("\n\n---\n\n") + "\n\n" : "";
}

function getCurrentDateTimeContext(): string {
	const now = new Date();
	const iso = now.toISOString();
	const locale = now.toLocaleString("zh-CN", {
		dateStyle: "long",
		timeStyle: "short",
		hour12: false,
	});
	return `当前时间：${iso}（UTC）；本地：${locale}。回答中涉及“今天”“现在”或时间解释时请以此为准。`;
}

export const MEMORY_FLUSH_DEFAULT_PROMPT =
	"Session nearing compaction. Write any lasting notes to MEMORY.md or memory/YYYY-MM-DD.md now. Reply with NO_REPLY if nothing to store.";

/**
 * 强制细粒度文本透传：
 * - 保持「真实流式」语义（仍来自上游 stream），不依赖 history 轮询；
 * - 若上游一次给出较大 delta，这里再切成更小片段，避免 UI 端看起来像“长时间无流式，最后整段出现”。
 */
function splitTextDelta(text: string, maxLen: number): string[] {
	if (!text) return [];
	if (text.length <= maxLen) return [text];
	const out: string[] = [];
	for (let i = 0; i < text.length; i += maxLen) out.push(text.slice(i, i + maxLen));
	return out;
}

export async function runMemoryFlushTurn(
	session: AgentSession,
	state: AgentState,
	config: AgentLoopConfig,
	streamFn: StreamFn,
	opts?: { prompt?: string },
): Promise<AgentState> {
	const prompt = opts?.prompt?.trim() || MEMORY_FLUSH_DEFAULT_PROMPT;
	const result = await runAgentTurnWithTools(state, config, streamFn, prompt, session.executeTool);
	return result.state;
}

/** LLM 配置（OpenAI 兼容接口：key、baseURL、model） */
export interface LlmConfig {
	apiKey: string;
	baseURL?: string;
	modelId: string;
}

const LLM_CONFIG_FILENAME = "llm.json";

/**
 * 从 agent 目录的 llm.json 加载 LLM 配置（OpenAI 兼容）。
 * 无兜底：apiKey、model 须在 llm.json 或环境变量 OPENAI_API_KEY、OPENAI_MODEL（或 OPENAI_DEFAULT_MODEL）中配置，缺则记为空并打日志说明。
 */
export function loadLlmConfig(agentDir?: string): LlmConfig {
	const fromEnv = {
		apiKey: (process.env.OPENAI_API_KEY ?? "").trim(),
		baseURL: process.env.OPENAI_BASE_URL?.trim() || undefined,
		modelId: (process.env.OPENAI_MODEL || process.env.OPENAI_DEFAULT_MODEL || "").trim(),
	};
	if (!agentDir) {
		if (!fromEnv.apiKey || !fromEnv.modelId) {
			console.warn(
				`${LOG_PREFIX} loadLlmConfig 未传 agentDir，且环境变量不完整: apiKey=${fromEnv.apiKey ? "已设" : "未设"} modelId=${fromEnv.modelId ? "已设" : "未设"}。请在 agent 目录配置 llm.json 或设置 OPENAI_API_KEY、OPENAI_MODEL。`,
			);
		}
		return fromEnv;
	}
	const configPath = path.join(agentDir, LLM_CONFIG_FILENAME);
	if (!existsSync(configPath)) {
		console.warn(
			`${LOG_PREFIX} loadLlmConfig llm.json 未找到 agentDir=${agentDir}，使用环境变量。若未设 OPENAI_API_KEY/OPENAI_MODEL 则运行将失败。`,
		);
		if (!fromEnv.apiKey || !fromEnv.modelId) {
			console.warn(
				`${LOG_PREFIX} 配置不完整: apiKey=${fromEnv.apiKey ? "已设" : "未设"} modelId=${fromEnv.modelId ? "已设" : "未设"}。请在 ${agentDir}/llm.json 或环境变量中配置。`,
			);
		}
		return fromEnv;
	}
	try {
		const raw = readFileSync(configPath, "utf-8");
		const data = JSON.parse(raw) as Record<string, unknown>;
		const apiKey = (data.apiKey as string)?.trim() || fromEnv.apiKey;
		const baseURL = (data.baseURL as string)?.trim() || fromEnv.baseURL;
		const modelId = (data.model as string)?.trim() || (data.modelId as string)?.trim() || fromEnv.modelId;
		if (!apiKey || !modelId) {
			console.warn(
				`${LOG_PREFIX} loadLlmConfig ${configPath} 或环境变量不完整: apiKey=${apiKey ? "已设" : "未设"} modelId=${modelId ? "已设" : "未设"}。请在 llm.json 中配置 apiKey、model（或 modelId），或设置 OPENAI_* 环境变量。`,
			);
		} else {
			console.info(`${LOG_PREFIX} loadLlmConfig agentDir=${agentDir} modelId=${modelId} (from llm.json)`);
		}
		return { apiKey, baseURL: baseURL || undefined, modelId };
	} catch (err) {
		console.warn(`${LOG_PREFIX} loadLlmConfig 读取/解析失败 path=${configPath}`, err);
		if (!fromEnv.apiKey || !fromEnv.modelId) {
			console.warn(
				`${LOG_PREFIX} 回退到环境变量仍不完整: apiKey=${fromEnv.apiKey ? "已设" : "未设"} modelId=${fromEnv.modelId ? "已设" : "未设"}。`,
			);
		}
		return fromEnv;
	}
}

export function createAgentContextFromU(
	session: AgentSession,
	opts?: { initialMessages?: AgentMessage[] },
): {
	state: AgentState;
	config: AgentLoopConfig;
	streamFn: StreamFn;
} {
	registerBuiltins();
	const { apiKey, baseURL, modelId } = loadLlmConfig(session.agentDir);
	if (!apiKey?.trim() || !modelId?.trim()) {
		const msg = `LLM 配置不完整: 请在 agent 目录「${session.agentDir}」下配置 llm.json（apiKey、model）或设置环境变量 OPENAI_API_KEY、OPENAI_MODEL。当前 apiKey=${apiKey ? "已设" : "未设"} modelId=${modelId ? "已设" : "未设"}`;
		console.error(`${LOG_PREFIX} ${msg}`);
		throw new Error(msg);
	}
	const llmStreamFn = createStreamFn(
		{ api: "openai" as const, id: modelId, provider: "openai" },
		{ apiKey, baseURL: baseURL || undefined },
	);
	const streamFn = async function* (
		messages: AgentMessage[],
		tools: Parameters<typeof llmStreamFn>[1],
		signal?: AbortSignal,
	): AsyncIterable<StreamChunk> {
		// 默认开启强制细分（可用 AGENT_STREAM_MAX_DELTA_CHARS 调整粒度）
		const maxDeltaCharsRaw = Number(process.env.AGENT_STREAM_MAX_DELTA_CHARS ?? "24");
		const maxDeltaChars = Number.isFinite(maxDeltaCharsRaw) && maxDeltaCharsRaw > 0 ? Math.floor(maxDeltaCharsRaw) : 24;
		for await (const rawChunk of llmStreamFn(toMinimalMessages(messages), tools, signal)) {
			const chunk = rawChunk as StreamChunk;
			if (chunk.type === "text") {
				const parts = splitTextDelta(chunk.text ?? "", maxDeltaChars);
				for (const part of parts) {
					if (part.length > 0) yield { type: "text", text: part } as StreamChunk;
				}
				continue;
			}
			// tool_call / done 保持原样透传
			yield chunk;
		}
	};
	const dateTimeContext = getCurrentDateTimeContext();
	const soulAndIdentity = readSoulAndIdentity(session.agentDir);
	const agentDirLabel = path.basename(session.agentDir) || "agent";
	const {
		state,
		config,
		streamFn: sf,
	} = createAgent({
		systemPrompt: `${soulAndIdentity}你由 agent 目录「${agentDirLabel}」加载。\n\n${dateTimeContext}`,
		skillDirs: session.skillDirs,
		tools: session.mergedTools,
		streamFn,
		initialMessages: opts?.initialMessages,
	});
	return { state, config, streamFn: sf };
}

const DEFAULT_CONTEXT_WINDOW = 128_000;

/**
 * Options for maybeCompactState: same model/config as createAgentContextFromU by default.
 * Pass agentDir to use that agent's llm.json; pass contextWindow / settings to override compaction thresholds.
 */
export interface MaybeCompactOptions {
	contextWindow?: number;
	settings?: Partial<CompactionSettings>;
	signal?: AbortSignal;
	customInstructions?: string;
	/** Agent 目录，用于读取 llm.json；不传则用环境变量 OPENAI_* */
	agentDir?: string;
	apiKey?: string;
	baseURL?: string;
}

/**
 * If state.messages exceed context window, compact: summarize older messages into a system message and keep recent.
 * Uses the same LLM as createAgentContextFromU (agent's llm.json or OPENAI_* env).
 * Call this before runAgentTurnWithTools when holding long-running state (e.g. Gateway session transcript).
 */
export async function maybeCompactState(state: AgentState, opts?: MaybeCompactOptions): Promise<AgentState> {
	registerBuiltins();
	const cfg = loadLlmConfig(opts?.agentDir);
	const apiKey = opts?.apiKey ?? cfg.apiKey;
	const baseURL = opts?.baseURL ?? cfg.baseURL;
	const contextWindow = opts?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
	if (!apiKey?.trim() || !cfg.modelId?.trim()) {
		console.warn(
			`${LOG_PREFIX} maybeCompactState 跳过: LLM 未配置（需传入 agentDir 或 opts 中的 llm 配置）。apiKey=${apiKey ? "已设" : "未设"} modelId=${cfg.modelId ? "已设" : "未设"}`,
		);
		return state;
	}

	const model = { api: "openai" as const, id: cfg.modelId, provider: "openai" as const };
	const completeFn = async (ctx: { systemPrompt: string; userText: string; signal?: AbortSignal }) => {
		const message = await complete(
			model,
			{
				systemPrompt: ctx.systemPrompt,
				messages: [{ role: "user", content: ctx.userText }],
			},
			{ apiKey, baseURL: baseURL || undefined, signal: ctx.signal, maxTokens: 4096 },
		);
		const text = message.content
			?.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("\n");
		return text ?? "";
	};

	if (!shouldCompact(state.messages, contextWindow, opts?.settings)) return state;
	return compactState(state, {
		completeFn,
		contextWindow,
		settings: opts?.settings,
		signal: opts?.signal,
		customInstructions: opts?.customInstructions,
	});
}
