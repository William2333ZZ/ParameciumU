/**
 * Code Skill：grep、glob、list。与 base_skill 配合实现「探索 → 读 → 改」闭环。
 */

import type { AgentTool } from "@monou/agent-core";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const GLOB_LIMIT = 100;
const DEFAULT_IGNORE = ["node_modules", ".git", "dist", "build", "target", "vendor", ".next", "coverage"];

function resolveRoot(raw: string | undefined): string {
	const p = (raw ?? "").trim();
	return p ? path.resolve(process.cwd(), p) : process.cwd();
}

function* walkDir(dir: string, opts: { ignore?: string[]; limit: number }): Generator<string> {
	const ignore = new Set([...DEFAULT_IGNORE, ...(opts.ignore ?? [])]);
	let count = 0;
	function* go(d: string, prefix: string): Generator<string> {
		if (count >= opts.limit) return;
		let entries: { name: string; isDirectory: () => boolean }[];
		try {
			entries = readdirSync(d, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of entries) {
			if (ignore.has(e.name)) continue;
			const rel = prefix ? `${prefix}/${e.name}` : e.name;
			if (e.isDirectory()) {
				yield* go(path.join(d, e.name), rel);
			} else {
				yield rel;
				count++;
				if (count >= opts.limit) return;
			}
		}
	}
	yield* go(dir, "");
}

function globToRegex(pattern: string): string {
	let s = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
	s = s.replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*").replace(/\?/g, ".");
	return s;
}

function globMatch(pattern: string, name: string): boolean {
	const re = new RegExp("^" + globToRegex(pattern) + "$");
	return re.test(name);
}

export const tools: AgentTool[] = [
	{
		name: "grep",
		description: "在代码库中按正则搜索文件内容，返回包含匹配的文件路径与行号。适合查找函数名、错误码、字符串常量等。支持 include 限制文件类型（如 *.ts）。",
		parameters: {
			type: "object",
			properties: {
				pattern: { type: "string", description: "正则表达式，用于在文件内容中搜索" },
				path: { type: "string", description: "搜索根目录，相对或绝对；默认当前工作目录" },
				include: { type: "string", description: "可选，文件 glob 过滤，例如 \"*.ts\" 或 \"*.{ts,tsx}\"" },
			},
			required: ["pattern"],
		},
	},
	{
		name: "glob",
		description: "按 glob 模式匹配文件名，返回匹配的文件路径列表（按修改时间倒序）。用于按命名模式找文件，如 src/**/*.tsx、**/package.json。",
		parameters: {
			type: "object",
			properties: {
				pattern: { type: "string", description: "glob 模式，如 **/*.ts、src/components/**/*.tsx" },
				path: { type: "string", description: "搜索根目录；默认当前工作目录" },
			},
			required: ["pattern"],
		},
	},
	{
		name: "list",
		description: "列出指定目录下的文件与子目录结构，可配置忽略模式（如 node_modules、.git）。路径省略时使用当前工作目录。",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string", description: "要列出的目录路径；省略则用当前工作目录" },
				ignore: {
					type: "array",
					items: { type: "string" },
					description: "可选，要忽略的目录/文件名，如 [\"node_modules\", \"dist\"]",
				},
			},
		},
	},
];

export async function executeTool(
	name: string,
	args: Record<string, unknown>,
): Promise<{ content: string; isError?: boolean }> {
	try {
		switch (name) {
			case "grep": {
				const pattern = String(args.pattern ?? "").trim();
				if (!pattern) return { content: "pattern is required", isError: true };
				const root = resolveRoot(args.path as string | undefined);
				const include = (args.include as string | undefined)?.trim();
				if (!existsSync(root)) return { content: `Path not found: ${root}`, isError: true };
				try {
					const includeArg = include ? ["--glob", include] : [];
					const out = execSync(
						["rg", "-n", "--no-heading", "--color", "never", "-e", pattern, ...includeArg, root].join(" "),
						{ encoding: "utf-8", maxBuffer: 4 * 1024 * 1024, cwd: process.cwd() },
					);
					return { content: out.trim() || "No matches" };
				} catch (e: unknown) {
					const code = (e as { status?: number })?.status;
					if (code === 1) return { content: "No matches" };
				}
				const lines: string[] = [];
				const includeRe = include
					? new RegExp("^" + include.replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*").replace(/\?/g, ".") + "$")
					: null;
				for (const rel of walkDir(root, { limit: 500 })) {
					if (includeRe && !includeRe.test(rel)) continue;
					const full = path.join(root, rel);
					let content: string;
					try {
						content = readFileSync(full, "utf-8");
					} catch {
						continue;
					}
					const re = new RegExp(pattern, "gm");
					let m: RegExpExecArray | null;
					while ((m = re.exec(content)) !== null) {
						const lineNum = content.slice(0, m.index).split("\n").length;
						const line = content.split("\n")[lineNum - 1] ?? "";
						lines.push(`${full}:${lineNum}:${line.trim()}`);
						if (lines.length >= 200) return { content: lines.join("\n") + "\n...(truncated)" };
					}
				}
				return { content: lines.length ? lines.join("\n") : "No matches" };
			}

			case "glob": {
				const pattern = String(args.pattern ?? "").trim();
				if (!pattern) return { content: "pattern is required", isError: true };
				const root = resolveRoot(args.path as string | undefined);
				if (!existsSync(root)) return { content: `Path not found: ${root}`, isError: true };
				const collected: { rel: string; mtime: number }[] = [];
				for (const rel of walkDir(root, { limit: 2000 })) {
					if (!globMatch(pattern, rel)) continue;
					const full = path.join(root, rel);
					try {
						const mtime = statSync(full).mtimeMs;
						collected.push({ rel: full, mtime });
					} catch {
						// skip
					}
				}
				collected.sort((a, b) => b.mtime - a.mtime);
				const limited = collected.slice(0, GLOB_LIMIT);
				const out = limited.map((x) => x.rel).join("\n");
				const truncated = collected.length > GLOB_LIMIT;
				return {
					content: out
						? out + (truncated ? `\n\n(Results truncated: showing first ${GLOB_LIMIT} of ${collected.length}.)` : "")
						: "No files found",
				};
			}

			case "list": {
				const root = resolveRoot(args.path as string | undefined);
				if (!existsSync(root)) return { content: `Path not found: ${root}`, isError: true };
				const stat = statSync(root);
				if (!stat.isDirectory()) return { content: `Not a directory: ${root}`, isError: true };
				const ignore = new Set([...DEFAULT_IGNORE, ...((args.ignore as string[]) ?? [])]);
				const entries = readdirSync(root, { withFileTypes: true })
					.filter((e) => !ignore.has(e.name))
					.map((e) => (e.isDirectory() ? e.name + "/" : e.name))
					.sort();
				return { content: entries.length ? entries.join("\n") : "(empty)" };
			}

			default:
				return { content: `Unknown tool: ${name}`, isError: true };
		}
	} catch (e) {
		return { content: e instanceof Error ? e.message : String(e), isError: true };
	}
}
