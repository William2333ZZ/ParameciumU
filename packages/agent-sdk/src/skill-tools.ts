/**
 * 从 skill 目录加载 tools 的约定与 API（参考 OpenClaw：skill 可提供工具定义与执行器）。
 *
 * 约定：skill 目录下可有 `tools.js`（或 `tools/index.js`），导出：
 * - tools: AgentTool[]
 * - executeTool?: (name: string, args: Record<string, unknown>) => Promise<{ content: string; isError?: boolean }>
 *
 * 若使用 TypeScript（tools.ts），需先编译为 tools.js，或由 runner 直接 import 后传入 createAgent。
 */

import type { AgentTool } from "@monou/agent-core";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

export interface SkillToolsModule {
	tools: AgentTool[];
	executeTool?: (
		name: string,
		args: Record<string, unknown>,
	) => Promise<{ content: string; isError?: boolean }>;
}

export interface LoadSkillToolsResult {
	tools: AgentTool[];
	/** 合并后的执行器：按 name 分发到各 skill 的 executeTool */
	executeTool?: (
		name: string,
		args: Record<string, unknown>,
	) => Promise<{ content: string; isError?: boolean }>;
}

/**
 * 从单个 skill 目录加载 tools 模块。
 * 按 skill-creator 约定优先查找 scripts/tools.js，其次 skill 根目录 tools.js、tools/index.js。
 * 目录下需存在编译后的 .js；若只有 .ts，请由 runner 直接 import 后传入 createAgent。
 */
export async function loadToolsFromSkillDir(skillDir: string): Promise<SkillToolsModule | null> {
	const candidates = [
		join(skillDir, "scripts", "tools.js"),
		join(skillDir, "tools.js"),
		join(skillDir, "tools", "index.js"),
	];
	for (const p of candidates) {
		try {
			const mod = await import(pathToFileURL(p).href);
			if (Array.isArray(mod.tools) && mod.tools.length > 0) {
				return {
					tools: mod.tools as AgentTool[],
					executeTool: typeof mod.executeTool === "function" ? mod.executeTool : undefined,
				};
			}
		} catch {
			// 文件不存在或非模块，跳过
		}
	}
	return null;
}

/**
 * 从多个 skill 目录加载并合并 tools 与 executeTool。
 * 多个 skill 都提供 executeTool 时，按「第一个能处理该 name 的」执行。
 */
export async function loadToolsFromSkillDirs(skillDirs: string[]): Promise<LoadSkillToolsResult> {
	const tools: AgentTool[] = [];
	const executors: SkillToolsModule["executeTool"][] = [];

	for (const dir of skillDirs) {
		const mod = await loadToolsFromSkillDir(dir);
		if (mod) {
			tools.push(...mod.tools);
			if (mod.executeTool) executors.push(mod.executeTool);
		}
	}

	const executeTool =
		executors.length === 0
			? undefined
			: async (
					name: string,
					args: Record<string, unknown>,
				): Promise<{ content: string; isError?: boolean }> => {
					for (const exec of executors) {
						if (typeof exec !== "function") continue;
						try {
							const out = await exec(name, args);
							if (out != null) return out;
						} catch (e) {
							// 该 skill 不处理此 name 或执行失败，尝试下一个
						}
					}
					return { content: `No executor for tool: ${name}`, isError: true };
				};

	return { tools, executeTool };
}
