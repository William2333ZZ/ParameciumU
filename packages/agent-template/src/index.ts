/**
 * Agent 目录模板与路径约定。仅负责 template 与 ensureAgentDir / getAgentDir，不包含运行逻辑。
 */

import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const U_BASE_AGENT_ID = "U_base";

/** 必备技能目录名（与 template/skills 一致） */
export const U_BASE_SKILL_NAMES = [
  "base_skill",
  "skill-creator",
  "memory",
  "knowledge",
  "cron",
  "web_skill",
  "browser_skill",
  "message_skill",
  "sessions_skill",
  "gateway_skill",
] as const;

/** 包内模板目录（dist 上一级为 package root） */
function getPackageTemplateDir(): string {
  const packageRoot = path.resolve(__dirname, "..");
  return path.join(packageRoot, "template");
}

/**
 * 返回工作区下 agent 目录路径（默认 ./.u）。
 */
export function getAgentDir(rootDir: string = process.cwd()): string {
  return path.join(path.resolve(rootDir), ".u");
}

export interface EnsureAgentDirOptions {
  /** 工作区根目录，默认 process.cwd()；与 agentDir 二选一 */
  rootDir?: string;
  /** 直接指定 agent 目录（与 .u 同构）；与 rootDir 二选一 */
  agentDir?: string;
  /** 若目录已存在是否仍覆盖（默认 false） */
  forceSync?: boolean;
}

/**
 * 确保 agent 目录存在：若不存在则从包内 template 复制。
 * 若已存在且未传 forceSync，则只补齐模板里有而目录里没有的项。
 */
export function ensureAgentDir(options: EnsureAgentDirOptions = {}): string {
  const rootDir = options.rootDir ?? process.cwd();
  const forceSync = options.forceSync ?? false;
  const agentDir =
    options.agentDir != null ? path.resolve(options.agentDir) : getAgentDir(rootDir);
  const templateDir = getPackageTemplateDir();

  if (!existsSync(templateDir)) {
    throw new Error(
      `@monou/agent-template: template not found at ${templateDir}. Run from monorepo or reinstall.`,
    );
  }

  mkdirSync(agentDir, { recursive: true });

  if (existsSync(agentDir) && !forceSync) {
    for (const name of readdirSync(templateDir)) {
      const dest = path.join(agentDir, name);
      if (!existsSync(dest)) {
        cpSync(path.join(templateDir, name), dest, { recursive: true });
      }
    }
    return agentDir;
  }

  cpSync(templateDir, agentDir, { recursive: true });
  return agentDir;
}

/**
 * 返回 agent 目录下必备技能的目录绝对路径。
 */
export function getAgentSkillDirs(
  rootOrAgentDir: string = process.cwd(),
  opts?: { asAgentDir?: boolean },
): string[] {
  const agentDir = opts?.asAgentDir ? path.resolve(rootOrAgentDir) : getAgentDir(rootOrAgentDir);
  return U_BASE_SKILL_NAMES.map((name) => path.join(agentDir, "skills", name));
}
