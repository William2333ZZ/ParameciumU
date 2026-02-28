/**
 * 从 agent 目录（.first_paramecium 或任意同构目录）加载并构建 session/context；运行逻辑在 app（gateway / u-tui / scripts）侧。
 */

export type { EnsureAgentDirOptions } from "@monou/agent-template";
export {
	ensureAgentDir,
	getAgentDir,
	getAgentSkillDirs,
	U_BASE_AGENT_ID,
	U_BASE_SKILL_NAMES,
} from "@monou/agent-template";
export type { AgentSession, BuildSessionFromUOptions, GatewayInvoke } from "./build-session.js";
export {
	buildSessionFromU,
	createAgentContextFromU,
	MEMORY_FLUSH_DEFAULT_PROMPT,
	runMemoryFlushTurn,
} from "./build-session.js";
export type { ScriptToolEntry } from "./load-skill-script-tools.js";
export {
	createSkillScriptExecutor,
	loadSkillScriptTools,
} from "./load-skill-script-tools.js";
