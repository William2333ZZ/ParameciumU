/**
 * 从 skill 目录发现「单脚本」并注册为独立工具。
 */

import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { AgentTool } from "@monou/agent-core";

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

function getSkillFrontmatterValue(skillDir: string, key: string): string | null {
	const skillPath = join(skillDir, "SKILL.md");
	if (!existsSync(skillPath)) return null;
	try {
		const raw = readFileSync(skillPath, "utf-8");
		const fm = raw.match(/^---\s*\n([\s\S]*?)\n---/m)?.[1];
		if (!fm) return null;
		const re = new RegExp(`^\\s*${key}\\s*:\\s*(.+?)\\s*$`, "m");
		const v = fm.match(re)?.[1]?.trim();
		if (!v) return null;
		return v.replace(/^["']|["']$/g, "");
	} catch {
		return null;
	}
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
		if (existsSync(join(dir, "scripts", "tools.js")) || existsSync(join(dir, "scripts", "tools.ts"))) continue;

		const files = readdirSync(scriptsDir);
		const scripts = files.filter((f) => SCRIPT_EXT.some((e) => f.endsWith(e)));
		if (scripts.length === 0) continue;
		const declaredEntry = getSkillFrontmatterValue(dir, "entryScript");
		// 兼容多脚本 skill（如 agent-creator）：优先选择约定入口脚本
		const entryScript =
			declaredEntry && scripts.includes(basename(declaredEntry))
				? basename(declaredEntry)
				:
			scripts.length === 1
				? scripts[0]
				: scripts.find((s) => s === "create-and-connect.sh");
		if (!entryScript) continue;

		const scriptName = entryScript;
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
