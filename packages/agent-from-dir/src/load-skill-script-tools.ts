/**
 * 从 skill 目录发现「单脚本」并注册为独立工具。
 */

import type { AgentTool } from "@monou/agent-core";
import { readdirSync, existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, resolve, basename } from "node:path";

const SCRIPT_EXT = [".sh", ".py"];

export interface ScriptToolEntry {
  name: string;
  skillDir: string;
  scriptPath: string;
  description: string;
}

function skillNameToToolName(dirPath: string): string {
  return basename(dirPath).replace(/-/g, "_");
}

function getDescriptionFromSkill(skillDir: string): string {
  const skillPath = join(skillDir, "SKILL.md");
  if (!existsSync(skillPath)) return "运行该 skill 的脚本，传入 path 参数。";
  try {
    const raw = readFileSync(skillPath, "utf-8");
    const m = raw.match(/^---\s*\n[\s\S]*?description:\s*(.+?)\s*\n[\s\S]*?---/m);
    if (m) return m[1].trim();
  } catch {
    // ignore
  }
  return "运行该 skill 的脚本，传入 path 参数。";
}

export function loadSkillScriptTools(
  skillDirs: string[],
  opts?: { excludeDirNames?: string[] },
): { tools: AgentTool[]; entries: ScriptToolEntry[] } {
  const exclude = new Set(opts?.excludeDirNames ?? ["base_skill"]);
  const entries: ScriptToolEntry[] = [];
  const tools: AgentTool[] = [];

  for (const dir of skillDirs) {
    const dirName = basename(dir);
    if (exclude.has(dirName)) continue;
    const scriptsDir = join(dir, "scripts");
    if (!existsSync(scriptsDir)) continue;
    if (existsSync(join(dir, "scripts", "tools.js")) || existsSync(join(dir, "scripts", "tools.ts")))
      continue;

    const files = readdirSync(scriptsDir);
    const scripts = files.filter((f) => SCRIPT_EXT.some((e) => f.endsWith(e)));
    if (scripts.length !== 1) continue;

    const scriptName = scripts[0];
    const scriptPath = join(scriptsDir, scriptName);
    const name = skillNameToToolName(dir);
    const description = getDescriptionFromSkill(dir);

    entries.push({ name, skillDir: dir, scriptPath, description });
    tools.push({
      name,
      description: `${description} 使用此工具而非 bash 直接执行。`,
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "传入脚本的参数（如文件路径）" } },
        required: ["path"],
      },
    });
  }

  return { tools, entries };
}

export function createSkillScriptExecutor(
  entries: ScriptToolEntry[],
): (name: string, args: Record<string, unknown>) => Promise<{ content: string; isError?: boolean }> {
  const byName = new Map(entries.map((e) => [e.name, e]));

  return async function execute(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ content: string; isError?: boolean }> {
    const entry = byName.get(name);
    if (!entry) return { content: `Unknown script tool: ${name}`, isError: true };

    const pathArg = String(args?.path ?? "").trim();
    const resolvedPath = pathArg ? resolve(process.cwd(), pathArg) : "";

    try {
      const isPy = entry.scriptPath.endsWith(".py");
      const cmd = isPy
        ? `python3 "${entry.scriptPath}" "${resolvedPath}"`
        : `bash "${entry.scriptPath}" "${resolvedPath}"`;
      const out = execSync(cmd, {
        encoding: "utf-8",
        maxBuffer: 4 * 1024 * 1024,
        cwd: process.cwd(),
      });
      return { content: out?.trim() ?? "" };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { content: msg, isError: true };
    }
  };
}
