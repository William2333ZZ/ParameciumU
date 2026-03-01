/**
 * Code Skill：grep、glob、list、code_search、apply_patch。与 base_skill 配合实现「探索 → 读 → 改」闭环。
 * code_search：自然语言/关键词搜索（多词 OR）。
 * apply_patch：V4A 多文件 diff（*** Add/Update/Delete File）。
 */

import type { AgentTool } from "@monou/agent-core";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
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

/** 从自然语言 query 提取搜索词（2+ 字符），拼成 OR 正则；对正则特殊字符转义。 */
function queryToPattern(query: string): string {
	const words = query
		.trim()
		.split(/\s+/)
		.map((w) => w.replace(/\s/g, ""))
		.filter((w) => w.length >= 2);
	if (words.length === 0) return query.trim() || ".";
	const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
	return escaped.join("|");
}

// ---------- V4A applyDiff (single-file) ----------
const END_PATCH = "*** End Patch";
const END_FILE = "*** End of File";
const SECTION_TERMINATORS = [END_PATCH, "*** Update File:", "*** Delete File:", "*** Add File:"];
const END_SECTION_MARKERS = [...SECTION_TERMINATORS, END_FILE];

type Chunk = { origIndex: number; delLines: string[]; insLines: string[] };

function normalizeDiffLines(diff: string): string[] {
	return diff
		.split(/\r?\n/)
		.map((line) => line.replace(/\r$/, ""))
		.filter((line, idx, arr) => !(idx === arr.length - 1 && line === ""));
}

function applyDiff(input: string, diff: string, mode: "default" | "create" = "default"): string {
	const diffLines = normalizeDiffLines(diff);
	if (mode === "create") return parseCreateDiff(diffLines);
	const { chunks } = parseUpdateDiff(diffLines, input);
	return applyChunks(input, chunks);
}

function parseCreateDiff(lines: string[]): string {
	const output: string[] = [];
	let i = 0;
	while (i < lines.length && !SECTION_TERMINATORS.some((p) => lines[i]?.startsWith(p))) {
		const line = lines[i];
		i++;
		if (!line.startsWith("+")) throw new Error(`Invalid Add File Line: ${line}`);
		output.push(line.slice(1));
	}
	return output.join("\n");
}

function parseUpdateDiff(lines: string[], input: string): { chunks: Chunk[]; fuzz: number } {
	const parser = { lines: [...lines, END_PATCH], index: 0, fuzz: 0 };
	const inputLines = input.split("\n");
	const chunks: Chunk[] = [];
	let cursor = 0;

	function isDone(prefixes: string[]): boolean {
		if (parser.index >= parser.lines.length) return true;
		if (prefixes.some((p) => parser.lines[parser.index]?.startsWith(p))) return true;
		return false;
	}
	function readStr(prefix: string): string {
		const current = parser.lines[parser.index];
		if (typeof current === "string" && current.startsWith(prefix)) {
			parser.index += 1;
			return current.slice(prefix.length);
		}
		return "";
	}

	while (!isDone(END_SECTION_MARKERS)) {
		const anchor = readStr("@@ ");
		const hasBareAnchor = parser.lines[parser.index] === "@@";
		if (hasBareAnchor) parser.index += 1;
		if (!(anchor || hasBareAnchor || cursor === 0)) {
			throw new Error(`Invalid Line:\n${parser.lines[parser.index]}`);
		}
		if (anchor.trim()) {
			cursor = advanceCursorToAnchor(anchor, inputLines, cursor, parser);
		}
		const { nextContext, sectionChunks, endIndex, eof } = readSection(parser.lines, parser.index);
		const findResult = findContext(inputLines, nextContext, cursor, eof);
		if (findResult.newIndex === -1) {
			const ctxText = nextContext.join("\n");
			if (eof) throw new Error(`Invalid EOF Context ${cursor}:\n${ctxText}`);
			throw new Error(`Invalid Context ${cursor}:\n${ctxText}`);
		}
		parser.fuzz += findResult.fuzz;
		for (const ch of sectionChunks) {
			chunks.push({ ...ch, origIndex: ch.origIndex + findResult.newIndex });
		}
		cursor = findResult.newIndex + nextContext.length;
		parser.index = endIndex;
	}
	return { chunks, fuzz: parser.fuzz };
}

function advanceCursorToAnchor(
	anchor: string,
	inputLines: string[],
	cursor: number,
	parser: { lines: string[]; index: number; fuzz: number },
): number {
	let found = false;
	if (!inputLines.slice(0, cursor).some((s) => s === anchor)) {
		for (let i = cursor; i < inputLines.length; i++) {
			if (inputLines[i] === anchor) {
				cursor = i + 1;
				found = true;
				break;
			}
		}
	}
	if (
		!found &&
		!inputLines.slice(0, cursor).some((s) => s.trim() === anchor.trim())
	) {
		for (let i = cursor; i < inputLines.length; i++) {
			if (inputLines[i].trim() === anchor.trim()) {
				cursor = i + 1;
				parser.fuzz += 1;
				found = true;
				break;
			}
		}
	}
	return cursor;
}

function readSection(
	lines: string[],
	startIndex: number,
): { nextContext: string[]; sectionChunks: Chunk[]; endIndex: number; eof: boolean } {
	const context: string[] = [];
	let delLines: string[] = [];
	let insLines: string[] = [];
	const sectionChunks: Chunk[] = [];
	let mode: "keep" | "add" | "delete" = "keep";
	let index = startIndex;
	const origIndex = index;

	while (index < lines.length) {
		const raw = lines[index];
		if (
			raw.startsWith("@@") ||
			raw.startsWith(END_PATCH) ||
			raw.startsWith("*** Update File:") ||
			raw.startsWith("*** Delete File:") ||
			raw.startsWith("*** Add File:") ||
			raw.startsWith(END_FILE)
		)
			break;
		if (raw === "***") break;
		if (raw.startsWith("***")) throw new Error(`Invalid Line: ${raw}`);
		index++;
		const lastMode = mode;
		const line = raw !== "" ? raw : " ";
		const prefix = line[0];
		if (prefix === "+") mode = "add";
		else if (prefix === "-") mode = "delete";
		else if (prefix === " ") mode = "keep";
		else throw new Error(`Invalid Line: ${line}`);
		const lineContent = line.slice(1);
		const switchingToContext = mode === "keep" && lastMode !== mode;
		if (switchingToContext && (delLines.length || insLines.length)) {
			sectionChunks.push({
				origIndex: context.length - delLines.length,
				delLines: [...delLines],
				insLines: [...insLines],
			});
			delLines = [];
			insLines = [];
		}
		if (mode === "delete") {
			delLines.push(lineContent);
			context.push(lineContent);
		} else if (mode === "add") {
			insLines.push(lineContent);
		} else {
			context.push(lineContent);
		}
	}
	if (delLines.length || insLines.length) {
		sectionChunks.push({
			origIndex: context.length - delLines.length,
			delLines: [...delLines],
			insLines: [...insLines],
		});
	}
	const eof = index < lines.length && lines[index] === END_FILE;
	if (eof) index++;
	if (index === origIndex) throw new Error(`Nothing in this section - index=${index} ${lines[index]}`);
	return { nextContext: context, sectionChunks, endIndex: index, eof };
}

function findContext(
	lines: string[],
	context: string[],
	start: number,
	eof: boolean,
): { newIndex: number; fuzz: number } {
	if (eof) {
		const endStart = Math.max(0, lines.length - context.length);
		const endMatch = findContextCore(lines, context, endStart);
		if (endMatch.newIndex !== -1) return endMatch;
		const fallback = findContextCore(lines, context, start);
		return { newIndex: fallback.newIndex, fuzz: fallback.fuzz + 10000 };
	}
	return findContextCore(lines, context, start);
}

function findContextCore(
	lines: string[],
	context: string[],
	start: number,
): { newIndex: number; fuzz: number } {
	if (!context.length) return { newIndex: start, fuzz: 0 };
	for (let i = start; i < lines.length; i++) {
		if (equalsSlice(lines, context, i, (s) => s)) return { newIndex: i, fuzz: 0 };
	}
	for (let i = start; i < lines.length; i++) {
		if (equalsSlice(lines, context, i, (s) => s.trimEnd())) return { newIndex: i, fuzz: 1 };
	}
	for (let i = start; i < lines.length; i++) {
		if (equalsSlice(lines, context, i, (s) => s.trim())) return { newIndex: i, fuzz: 100 };
	}
	return { newIndex: -1, fuzz: 0 };
}

function equalsSlice(
	source: string[],
	target: string[],
	start: number,
	mapFn: (s: string) => string,
): boolean {
	if (start + target.length > source.length) return false;
	for (let i = 0; i < target.length; i++) {
		if (mapFn(source[start + i]) !== mapFn(target[i])) return false;
	}
	return true;
}

function applyChunks(input: string, chunks: Chunk[]): string {
	const origLines = input.split("\n");
	const destLines: string[] = [];
	let origIndex = 0;
	for (const chunk of chunks) {
		if (chunk.origIndex > origLines.length)
			throw new Error(`applyDiff: chunk.origIndex ${chunk.origIndex} > input length ${origLines.length}`);
		if (origIndex > chunk.origIndex)
			throw new Error(`applyDiff: overlapping chunk at ${chunk.origIndex} (cursor ${origIndex})`);
		destLines.push(...origLines.slice(origIndex, chunk.origIndex));
		origIndex = chunk.origIndex;
		if (chunk.insLines.length) destLines.push(...chunk.insLines);
		origIndex += chunk.delLines.length;
	}
	destLines.push(...origLines.slice(origIndex));
	return destLines.join("\n");
}

/** 解析多文件 V4A patch，返回 { type, path, body }[]，path 为行内路径（需 resolve）。 */
function parseMultifilePatch(patchText: string): Array<{ type: "add" | "update" | "delete"; path: string; body: string }> {
	const lines = patchText.split(/\r?\n/);
	const sections: Array<{ type: "add" | "update" | "delete"; path: string; body: string }> = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		i++;
		if (line?.startsWith("*** Add File:")) {
			const filePath = line.slice("*** Add File:".length).trim();
			const bodyLines: string[] = [];
			while (i < lines.length && !lines[i]?.startsWith("***")) {
				bodyLines.push(lines[i] ?? "");
				i++;
			}
			sections.push({ type: "add", path: filePath, body: bodyLines.join("\n") });
			continue;
		}
		if (line?.startsWith("*** Update File:")) {
			const filePath = line.slice("*** Update File:".length).trim();
			const bodyLines: string[] = [];
			while (i < lines.length && !lines[i]?.startsWith("***")) {
				bodyLines.push(lines[i] ?? "");
				i++;
			}
			sections.push({ type: "update", path: filePath, body: bodyLines.join("\n") });
			continue;
		}
		if (line?.startsWith("*** Delete File:")) {
			const filePath = line.slice("*** Delete File:".length).trim();
			sections.push({ type: "delete", path: filePath, body: "" });
			continue;
		}
		if (line === END_PATCH || line?.startsWith("*** End")) break;
	}
	return sections;
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
	{
		name: "code_search",
		description:
			"按自然语言或关键词在代码库中搜索。将 query 拆成多个词做 OR 匹配，适合「找和 X 相关的代码」「哪里处理 Y」。与 grep 互补：grep 用正则精确搜，code_search 用短语/词模糊搜。",
		parameters: {
			type: "object",
			properties: {
				query: { type: "string", description: "搜索问句或关键词，如 \"authentication handler\"、\"error boundary\"" },
				path: { type: "string", description: "搜索根目录；默认当前工作目录" },
				include: { type: "string", description: "可选，文件 glob 过滤，如 \"*.ts\"" },
			},
			required: ["query"],
		},
	},
	{
		name: "apply_patch",
		description:
			"应用 V4A 格式的多文件 diff。patch_text 可包含 *** Add File:/*** Update File:/*** Delete File: 多个块。适合单次多文件修改、与 OpenCode/IDE 兼容的 patch。路径为相对 root 或绝对。",
		parameters: {
			type: "object",
			properties: {
				patch_text: { type: "string", description: "完整 V4A patch 内容（*** Add/Update/Delete File: path 与 +/- 行，*** End Patch 结尾）" },
				root: { type: "string", description: "可选，解析相对路径的根目录；默认当前工作目录" },
			},
			required: ["patch_text"],
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
				if (!existsSync(root)) return { content: `Path not found: ${root}`, isError: true }
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
					// code 2 or other: fall through to Node fallback below
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

			case "code_search": {
				const query = String(args.query ?? "").trim();
				if (!query) return { content: "query is required", isError: true };
				const pattern = queryToPattern(query);
				const root = resolveRoot(args.path as string | undefined);
				const include = (args.include as string | undefined)?.trim();
				if (!existsSync(root)) return { content: `Path not found: ${root}`, isError: true };
				try {
					const includeArg = include ? ["--glob", include] : [];
					const out = execSync(
						["rg", "-n", "--no-heading", "--color", "never", "-e", pattern, ...includeArg, root].join(" "),
						{ encoding: "utf-8", maxBuffer: 4 * 1024 * 1024, cwd: process.cwd() },
					);
					const lines = out.trim().split("\n").filter(Boolean);
					const limited = lines.slice(0, 150);
					const content = limited.join("\n") + (lines.length > 150 ? `\n...(truncated, ${lines.length} total)` : "");
					return { content: content || "No matches" };
				} catch (e: unknown) {
					const code = (e as { status?: number })?.status;
					if (code === 1) return { content: "No matches" };
				}
				const lines: string[] = [];
				const includeRe = include
					? new RegExp("^" + include.replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*").replace(/\?/g, ".") + "$")
					: null;
				const re = new RegExp(pattern, "gm");
				for (const rel of walkDir(root, { limit: 500 })) {
					if (includeRe && !includeRe.test(rel)) continue;
					const full = path.join(root, rel);
					let content: string;
					try {
						content = readFileSync(full, "utf-8");
					} catch {
						continue;
					}
					let m: RegExpExecArray | null;
					while ((m = re.exec(content)) !== null) {
						const lineNum = content.slice(0, m.index).split("\n").length;
						const line = content.split("\n")[lineNum - 1] ?? "";
						lines.push(`${full}:${lineNum}:${line.trim()}`);
						if (lines.length >= 150) {
							return { content: lines.join("\n") + "\n...(truncated)" };
						}
					}
				}
				return { content: lines.length ? lines.join("\n") : "No matches" };
			}

			case "apply_patch": {
				const patchText = String(args.patch_text ?? "").trim();
				if (!patchText) return { content: "patch_text is required", isError: true };
				const root = resolveRoot(args.root as string | undefined);
				const sections = parseMultifilePatch(patchText);
				if (sections.length === 0) return { content: "No *** Add/Update/Delete File sections in patch", isError: true };
				const results: string[] = [];
				for (const sec of sections) {
					const absPath = path.isAbsolute(sec.path) ? sec.path : path.join(root, sec.path);
					try {
						if (sec.type === "add") {
							const content = applyDiff("", sec.body, "create");
							const dir = path.dirname(absPath);
							if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
							writeFileSync(absPath, content, "utf-8");
							results.push(`Added ${absPath}`);
						} else if (sec.type === "update") {
							if (!existsSync(absPath)) {
								results.push(`Skip (not found): ${absPath}`);
								continue;
							}
							const content = readFileSync(absPath, "utf-8");
							const newContent = applyDiff(content, sec.body, "default");
							writeFileSync(absPath, newContent, "utf-8");
							results.push(`Updated ${absPath}`);
						} else {
							if (!existsSync(absPath)) {
								results.push(`Skip (not found): ${absPath}`);
								continue;
							}
							unlinkSync(absPath);
							results.push(`Deleted ${absPath}`);
						}
					} catch (err) {
						results.push(`${sec.type} ${absPath}: ${err instanceof Error ? err.message : String(err)}`);
					}
				}
				return { content: results.join("\n") };
			}

			default:
				return { content: `Unknown tool: ${name}`, isError: true };
		}
	} catch (e) {
		return { content: e instanceof Error ? e.message : String(e), isError: true };
	}
}
