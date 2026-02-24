/**
 * 从 .u 目录构建 AgentSession 与 createAgentContextFromU。
 */

import type { AgentMessage, AgentState, AgentLoopConfig, StreamFn } from "@monou/agent-core";
import type { AgentTool } from "@monou/agent-core";
import type { StreamChunk } from "@monou/agent-core";
import { createAgent, runAgentTurnWithTools } from "@monou/agent-sdk";
import { compactState, shouldCompact, type CompactionSettings } from "@monou/agent-core";
import { registerBuiltins, createStreamFn, complete } from "@monou/llm-provider";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  ensureAgentDir,
  getAgentSkillDirs,
  U_BASE_SKILL_NAMES,
} from "@monou/agent-template";
import { loadSkillScriptTools, createSkillScriptExecutor } from "./load-skill-script-tools.js";

const MEMORY_TOOL_NAMES = new Set([
  "memory_search",
  "memory_get",
  "memory_store",
  "memory_recall",
  "memory_forget",
  "memory_sync",
]);
const KNOWLEDGE_TOOL_NAMES = new Set([
  "knowledge_search",
  "knowledge_get",
  "knowledge_sync",
  "knowledge_add",
  "knowledge_learn",
  "knowledge_list_topics",
  "knowledge_list_points",
  "knowledge_learn_from_urls",
  "knowledge_skill_create",
]);
const CRON_TOOL_NAMES = new Set([
  "cron_status",
  "cron_list",
  "cron_add",
  "cron_update",
  "cron_remove",
  "cron_run",
  "cron_start_scheduler",
]);
const WEB_TOOL_NAMES = new Set(["web_fetch", "web_search"]);
const MESSAGE_TOOL_NAMES = new Set(["send_message"]);
const SESSIONS_TOOL_NAMES = new Set(["sessions_list", "sessions_preview", "sessions_send"]);

export interface AgentSession {
  agentDir: string;
  skillDirs: string[];
  mergedTools: AgentTool[];
  executeTool: (name: string, args: Record<string, unknown>) => Promise<{ content: string; isError?: boolean }>;
}

export type GatewayInvoke = (method: string, params: Record<string, unknown>) => Promise<unknown>;

export interface BuildSessionFromUOptions {
  agentDir?: string;
  gatewayInvoke?: GatewayInvoke;
  /** When true, use agentDir as-is without ensureAgentDir (for tests with minimal fixture). */
  skipEnsureAgentDir?: boolean;
}

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
  const baseSkillDirs = getAgentSkillDirs(agentDir, { asAgentDir: true });
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

  const scriptsDir = (skillName: string) => path.join(agentDir, "skills", skillName, "scripts");
  const toolsPath = (skillName: string) => {
    const dir = scriptsDir(skillName);
    const js = path.join(dir, "tools.js");
    const ts = path.join(dir, "tools.ts");
    if (existsSync(js)) return js;
    if (existsSync(ts)) return ts;
    return null;
  };
  const noopSkill = (): { tools: AgentTool[]; executeTool: (name: string, args: Record<string, unknown>) => Promise<{ content: string; isError?: boolean }> } => ({
    tools: [],
    executeTool: async () => ({ content: "skill not loaded", isError: true }),
  });
  const loadSkillModule = async (scriptPath: string | null) => {
    if (!scriptPath) return noopSkill();
    try {
      const mod = await import(pathToFileURL(scriptPath).href);
      return {
        tools: (mod.tools ?? []) as AgentTool[],
        executeTool: (mod.executeTool ?? noopSkill().executeTool) as (name: string, args: Record<string, unknown>) => Promise<{ content: string; isError?: boolean }>,
      };
    } catch {
      return noopSkill();
    }
  };

  const baseSkillModule = await loadSkillModule(toolsPath("base_skill"));
  const memoryModule = await loadSkillModule(toolsPath("memory"));
  const cronModule = await loadSkillModule(toolsPath("cron"));
  const knowledgePath = toolsPath("knowledge");

  const knowledgeModule = knowledgePath ? await loadSkillModule(knowledgePath) : noopSkill();
  const knowledgeTools = knowledgeModule.tools;
  const knowledgeExecuteTool = knowledgeModule.executeTool as (name: string, args: Record<string, unknown>) => Promise<{ content: string; isError?: boolean }>;

  const webSkillModule = await loadSkillModule(toolsPath("web_skill"));
  const webSkillTools = webSkillModule.tools;
  const webSkillExecuteTool = webSkillModule.executeTool as (name: string, args: Record<string, unknown>) => Promise<{ content: string; isError?: boolean }>;

  const messageSkillModule = await loadSkillModule(toolsPath("message_skill"));
  const messageSkillTools = messageSkillModule.tools;
  const messageSkillExecuteTool = messageSkillModule.executeTool as (name: string, args: Record<string, unknown>, gatewayInvoke?: GatewayInvoke) => Promise<{ content: string; isError?: boolean }>;

  const sessionsSkillModule = await loadSkillModule(toolsPath("sessions_skill"));
  const sessionsSkillTools = sessionsSkillModule.tools;
  const sessionsSkillExecuteTool = sessionsSkillModule.executeTool as (name: string, args: Record<string, unknown>, gatewayInvoke?: GatewayInvoke) => Promise<{ content: string; isError?: boolean }>;

  const baseSkillTools = baseSkillModule.tools;
  const baseSkillExecuteTool = baseSkillModule.executeTool;
  const memoryTools = memoryModule.tools;
  const memoryExecuteTool = memoryModule.executeTool;
  const cronTools = cronModule.tools;
  const cronExecuteTool = cronModule.executeTool;

  const { tools: scriptTools, entries: scriptEntries } = loadSkillScriptTools(skillDirs, {
    excludeDirNames: ["base_skill", "skill-creator", "memory", "knowledge", "cron", "web_skill", "message_skill", "sessions_skill"],
  });
  const executeSkillScript = createSkillScriptExecutor(scriptEntries);

  const knowledgeTopicTools: AgentTool[] = [];
  const knowledgeTopicByToolName = new Map<string, string>();
  if (existsSync(skillsRoot)) {
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
      knowledgeTopicByToolName.set(toolName, topic);
    }
  }

  const mergedTools = [
    ...baseSkillTools,
    ...memoryTools,
    ...knowledgeTools,
    ...knowledgeTopicTools,
    ...cronTools,
    ...webSkillTools,
    ...messageSkillTools,
    ...sessionsSkillTools,
    ...scriptTools,
  ];
  const scriptToolNames = new Set(scriptEntries.map((e) => e.name));
  const gatewayInvoke = opts?.gatewayInvoke;

  async function executeTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ content: string; isError?: boolean }> {
    if (MEMORY_TOOL_NAMES.has(name)) return memoryExecuteTool(name, args);
    if (KNOWLEDGE_TOOL_NAMES.has(name)) return knowledgeExecuteTool(name, args);
    const topicForKnowledge = knowledgeTopicByToolName.get(name);
    if (topicForKnowledge != null) {
      return knowledgeExecuteTool("knowledge_search", {
        query: args?.query,
        topic: topicForKnowledge,
        maxResults: args?.maxResults,
      });
    }
    if (CRON_TOOL_NAMES.has(name)) return cronExecuteTool(name, args);
    if (WEB_TOOL_NAMES.has(name)) return webSkillExecuteTool(name, args);
    if (MESSAGE_TOOL_NAMES.has(name)) return messageSkillExecuteTool(name, args, gatewayInvoke);
    if (SESSIONS_TOOL_NAMES.has(name)) return sessionsSkillExecuteTool(name, args, gatewayInvoke);
    if (scriptToolNames.has(name)) return executeSkillScript(name, args);
    return baseSkillExecuteTool(name, args);
  }
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

/** 从环境变量解析 LLM 配置：优先级 BIANXIE > AIHUBMIX > OPENAI */
function getLlmEnv(): { apiKey: string; baseURL?: string; modelId: string } {
  const bianxie = process.env.BIANXIE_API_KEY;
  const aihubmix = process.env.AIHUBMIX_API_KEY;
  const openai = process.env.OPENAI_API_KEY;
  if (bianxie) {
    return {
      apiKey: bianxie,
      baseURL: process.env.BIANXIE_BASE_URL || undefined,
      modelId: process.env.BIANXIE_MODEL || "gpt-4o-mini",
    };
  }
  if (aihubmix) {
    return {
      apiKey: aihubmix,
      baseURL: process.env.AIHUBMIX_BASE_URL || undefined,
      modelId: process.env.AIHUBMIX_MODEL || "gpt-4o-mini",
    };
  }
  return {
    apiKey: openai ?? "",
    baseURL: process.env.OPENAI_BASE_URL || undefined,
    modelId: process.env.OPENAI_MODEL || "gpt-4o-mini",
  };
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
  const { apiKey, baseURL, modelId } = getLlmEnv();
  const llmStreamFn = createStreamFn(
    { api: "openai" as const, id: modelId, provider: "openai" },
    { apiKey, baseURL: baseURL || undefined },
  );
  const streamFn = async function* (
    messages: AgentMessage[],
    tools: Parameters<typeof llmStreamFn>[1],
    signal?: AbortSignal,
  ): AsyncIterable<StreamChunk> {
    for await (const chunk of llmStreamFn(toMinimalMessages(messages), tools, signal))
      yield chunk as StreamChunk;
  };
  const dateTimeContext = getCurrentDateTimeContext();
  const soulAndIdentity = readSoulAndIdentity(session.agentDir);
  const { state, config, streamFn: sf } = createAgent({
    systemPrompt: `${soulAndIdentity}你是 U_base 编码助手，从 .u 加载 skills。请遵循 base_skill、skill-creator、memory、knowledge、cron 等工具与准则。

**Memory Recall**：在回答与 prior work、decisions、dates、people、preferences、todos 相关的问题前，先执行 memory_search（或 memory_recall），再用 memory_get 按需拉取片段；若搜索后仍无把握，可说明已查过记忆。

**Knowledge**：在回答根据文档/知识库/FAQ/如何配置类问题前，先执行 knowledge_search，再用 knowledge_get 按需拉取片段。

${dateTimeContext}`,
    skillDirs: session.skillDirs,
    tools: session.mergedTools,
    streamFn,
    initialMessages: opts?.initialMessages,
  });
  return { state, config, streamFn: sf };
}

/** Default model used for main agent and for compaction summary (same model recommended). */
const DEFAULT_LLM_MODEL = { api: "openai" as const, id: "gpt-4o-mini", provider: "openai" };

const DEFAULT_CONTEXT_WINDOW = 128_000;

/**
 * Options for maybeCompactState: same model/env as createAgentContextFromU by default.
 * Pass contextWindow / settings to override compaction thresholds.
 */
export interface MaybeCompactOptions {
	contextWindow?: number;
	settings?: Partial<CompactionSettings>;
	signal?: AbortSignal;
	customInstructions?: string;
	apiKey?: string;
	baseURL?: string;
}

/**
 * If state.messages exceed context window, compact: summarize older messages into a system message and keep recent.
 * Uses the same LLM as createAgentContextFromU (env: BIANXIE_* / AIHUBMIX_* / OPENAI_*).
 * Call this before runAgentTurnWithTools when holding long-running state (e.g. Gateway session transcript).
 */
export async function maybeCompactState(
	state: AgentState,
	opts?: MaybeCompactOptions,
): Promise<AgentState> {
	registerBuiltins();
	const env = getLlmEnv();
	const apiKey = opts?.apiKey ?? env.apiKey;
	const baseURL = opts?.baseURL ?? env.baseURL;
	const contextWindow = opts?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
	if (!apiKey) return state;

	const model = { api: "openai" as const, id: env.modelId, provider: "openai" as const };
	const completeFn = async (ctx: {
		systemPrompt: string;
		userText: string;
		signal?: AbortSignal;
	}) => {
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
