/**
 * 从 agent 目录（.u 或任意同构目录）加载并构建 session/context；运行逻辑在 app（gateway / u-tui / scripts）侧。
 */

export {
  ensureAgentDir,
  getAgentDir,
  getAgentSkillDirs,
  U_BASE_AGENT_ID,
  U_BASE_SKILL_NAMES,
} from "@monou/agent-template";
export type { EnsureAgentDirOptions } from "@monou/agent-template";

export {
  buildSessionFromU,
  createAgentContextFromU,
  runMemoryFlushTurn,
  MEMORY_FLUSH_DEFAULT_PROMPT,
} from "./build-session.js";
export type { AgentSession, GatewayInvoke, BuildSessionFromUOptions } from "./build-session.js";
export {
  loadSkillScriptTools,
  createSkillScriptExecutor,
} from "./load-skill-script-tools.js";
export type { ScriptToolEntry } from "./load-skill-script-tools.js";
