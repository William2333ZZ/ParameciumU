/**
 * Base Skill 工具定义与执行器（按 skill-creator 约定放在 skill/scripts/）。
 * 供 createAgent + runAgentTurnWithTools 使用；可由 loadToolsFromSkillDir 从 scripts/tools.js 加载（需先编译）。
 */

import type { AgentTool } from "@monou/agent-core";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve } from "node:path";

export const tools: AgentTool[] = [
	{
		name: "read",
		description: "读取文件内容。编辑前必须先读取。",
		parameters: {
			type: "object",
			properties: { path: { type: "string", description: "文件路径" } },
			required: ["path"],
		},
	},
	{
		name: "bash",
		description: "执行 bash 命令（ls、grep、find 等）。",
		parameters: {
			type: "object",
			properties: { command: { type: "string", description: "要执行的 shell 命令" } },
			required: ["command"],
		},
	},
	{
		name: "edit",
		description: "对文件做精确编辑（查找并替换旧内容）。oldText 必须与文件内容完全匹配。",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string", description: "文件路径" },
				oldText: { type: "string", description: "要被替换的精确文本" },
				newText: { type: "string", description: "新文本" },
			},
			required: ["path", "oldText", "newText"],
		},
	},
	{
		name: "write",
		description: "创建或整文件覆盖写入。仅用于新文件或完整重写。",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string", description: "文件路径" },
				content: { type: "string", description: "完整文件内容" },
			},
			required: ["path", "content"],
		},
	},
];

function resolvePath(raw: string): string {
	const p = (raw ?? "").trim();
	return p ? resolve(process.cwd(), p) : "";
}

export async function executeTool(
	name: string,
	args: Record<string, unknown>,
): Promise<{ content: string; isError?: boolean }> {
	try {
		switch (name) {
			case "read": {
				const path = resolvePath(String(args.path ?? ""));
				if (!path) return { content: "path is required", isError: true };
				if (!existsSync(path)) return { content: `File not found: ${path}`, isError: true };
				return { content: readFileSync(path, "utf-8") };
			}
			case "bash": {
				const command = String(args.command ?? "").trim();
				if (!command) return { content: "command is required", isError: true };
				const out = execSync(command, {
					encoding: "utf-8",
					maxBuffer: 4 * 1024 * 1024,
					cwd: process.cwd(),
				});
				return { content: out || "(no output)" };
			}
			case "edit": {
				const path = resolvePath(String(args.path ?? ""));
				const oldText = String(args.oldText ?? "");
				const newText = String(args.newText ?? "");
				if (!path) return { content: "path is required", isError: true };
				if (!existsSync(path)) return { content: `File not found: ${path}`, isError: true };
				const content = readFileSync(path, "utf-8");
				if (!content.includes(oldText))
					return { content: "oldText not found in file (must match exactly).", isError: true };
				writeFileSync(path, content.replace(oldText, newText), "utf-8");
				return { content: `Edited ${path}` };
			}
			case "write": {
				const path = resolvePath(String(args.path ?? ""));
				const content = String(args.content ?? "");
				if (!path) return { content: "path is required", isError: true };
				writeFileSync(path, content, "utf-8");
				return { content: `Wrote ${path}` };
			}
			default:
				return { content: `Unknown tool: ${name}`, isError: true };
		}
	} catch (e) {
		return { content: e instanceof Error ? e.message : String(e), isError: true };
	}
}
