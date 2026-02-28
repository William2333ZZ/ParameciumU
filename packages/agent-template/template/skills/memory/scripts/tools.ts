/**
 * Memory skill：memory_search、memory_get、memory_store、memory_recall、memory_forget、memory_sync。
 * 工作区默认 ./.first_paramecium（MEMORY.md、memory/*.md），或 MEMORY_WORKSPACE。
 * 可选 FTS5 索引（Node 22+ node:sqlite）存于 .first_paramecium/memory/index.sqlite；可选向量混合检索（EMBEDDING_API_KEY）；
 * 可选会话转录索引（MEMORY_INDEX_SESSION=1，MEMORY_SESSION_PATH）。
 */

import type { AgentTool } from "@monou/agent-core";
import { readFileSync, existsSync, readdirSync, mkdirSync, appendFileSync } from "node:fs";
import { join, resolve } from "node:path";

const DEFAULT_MAX_RESULTS = 10;
const INDEX_DIR = "memory";
const INDEX_FILENAME = "index.sqlite";
const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_EMBEDDING_BASE = "https://api.openai.com/v1";

function getWorkspaceDir(): string {
	const env = process.env.MEMORY_WORKSPACE?.trim();
	if (env) return resolve(env);
	return join(process.cwd(), ".first_paramecium");
}

function getIndexPath(workspaceDir: string): string {
	const env = process.env.MEMORY_INDEX_PATH?.trim();
	if (env) return resolve(env);
	return join(workspaceDir, INDEX_DIR, INDEX_FILENAME);
}

/** 解析 MEMORY_EXTRA_PATHS（逗号分隔，相对工作区或绝对路径），用于 path 白名单与索引范围。 */
function getExtraPaths(workspaceDir: string): string[] {
	const raw = process.env.MEMORY_EXTRA_PATHS?.trim();
	if (!raw) return [];
	return raw.split(",").map((p) => p.trim()).filter(Boolean);
}

/** 是否为允许的记忆路径：MEMORY.md、memory.md、memory/*.md、session/*.md（转录）或 extraPaths。 */
function isMemoryPath(relPath: string, workspaceDir: string): boolean {
	const normalized = relPath.replace(/\\/g, "/");
	if (normalized === "MEMORY.md" || normalized === "memory.md") return true;
	if (normalized.startsWith("memory/") && normalized.endsWith(".md")) return true;
	if (normalized.startsWith("session/") && normalized.endsWith(".md")) return true;
	const extra = getExtraPaths(workspaceDir);
	for (const p of extra) {
		const abs = p.startsWith("/") ? p : join(workspaceDir, p);
		const rel = resolve(workspaceDir, normalized);
		if (resolve(abs) === rel || rel.startsWith(resolve(abs) + "/")) return true;
	}
	return false;
}

function listMemoryFiles(workspaceDir: string): { path: string; absPath: string }[] {
	const out: { path: string; absPath: string }[] = [];
	const root = ["MEMORY.md", "memory.md"];
	for (const name of root) {
		const abs = join(workspaceDir, name);
		if (existsSync(abs)) out.push({ path: name, absPath: abs });
	}
	const memDir = join(workspaceDir, "memory");
	if (existsSync(memDir)) {
		try {
			const names = readdirSync(memDir);
			for (const name of names) {
				if (!name.endsWith(".md")) continue;
				const abs = join(memDir, name);
				if (existsSync(abs)) out.push({ path: join("memory", name), absPath: abs });
			}
		} catch {
			// ignore
		}
	}
	const extra = getExtraPaths(workspaceDir);
	for (const p of extra) {
		const abs = p.startsWith("/") ? p : join(workspaceDir, p);
		if (existsSync(abs)) {
			const rel = abs.startsWith(workspaceDir) ? join(abs.slice(workspaceDir.length)).replace(/^[/\\]/, "") : p;
			if (!out.some((e) => e.absPath === resolve(abs))) out.push({ path: rel, absPath: resolve(abs) });
		}
	}
	return out;
}

function escapeRe(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function searchInFile(
	absPath: string,
	relPath: string,
	query: string,
	maxResults: number,
): Array<{ path: string; startLine: number; endLine: number; snippet: string; score: number }> {
	const results: Array<{ path: string; startLine: number; endLine: number; snippet: string; score: number }> = [];
	let content: string;
	try {
		content = readFileSync(absPath, "utf-8");
	} catch {
		return results;
	}
	const lines = content.split(/\r?\n/);
	const q = query.trim();
	const words = q.split(/\s+/).filter(Boolean);
	const pattern = words.length > 0 ? new RegExp(escapeRe(q), "gi") : null;
	for (let i = 0; i < lines.length && results.length < maxResults; i++) {
		const line = lines[i];
		if (!pattern) continue;
		if (!pattern.test(line)) continue;
		const snippet = line.trim().slice(0, 500);
		results.push({
			path: relPath,
			startLine: i + 1,
			endLine: i + 1,
			snippet,
			score: 1,
		});
	}
	return results;
}

// --- FTS5 索引（Node 22+ node:sqlite 可用时使用）---

type SqliteDb = { run: (sql: string, ...params: unknown[]) => void; all: (sql: string, ...params: unknown[]) => unknown[]; exec: (sql: string) => void };
type SqliteMod = { default: { DatabaseSync: new (path: string) => SqliteDb } };

let _sqliteModule: SqliteMod | null = null;

async function loadSqlite(): Promise<SqliteMod | null> {
	if (_sqliteModule != null) return _sqliteModule;
	try {
		_sqliteModule = (await import("node:sqlite")) as SqliteMod;
		return _sqliteModule;
	} catch {
		return null;
	}
}

function openIndexDbWithMod(indexPath: string, mod: SqliteMod): SqliteDb {
	const db = new mod.default.DatabaseSync(indexPath);
	db.exec(
		"CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(path, start_line, end_line, content, tokenize='unicode61')",
	);
	db.exec(
		"CREATE TABLE IF NOT EXISTS chunk_embeddings(path TEXT, start_line INTEGER, end_line INTEGER, content TEXT, embedding_json TEXT)",
	);
	return db;
}

async function runSyncAsync(workspaceDir: string): Promise<{ ok: boolean; error?: string }> {
	const mod = await loadSqlite();
	if (!mod) return { ok: false, error: "SQLite (node:sqlite) not available; requires Node 22+" };
	const indexPath = getIndexPath(workspaceDir);
	const dir = resolve(indexPath, "..");
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	try {
		const db = openIndexDbWithMod(indexPath, mod);
		db.exec("DELETE FROM chunks_fts");
		db.exec("DELETE FROM chunk_embeddings");
		const files = listMemoryFiles(workspaceDir);
		for (const { path: relPath, absPath } of files) {
			let content: string;
			try {
				content = readFileSync(absPath, "utf-8");
			} catch {
				continue;
			}
			const lines = content.split(/\r?\n/);
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				if (!line.trim()) continue;
				db.run(
					"INSERT INTO chunks_fts(path, start_line, end_line, content) VALUES(?, ?, ?, ?)",
					relPath,
					i + 1,
					i + 1,
					line,
				);
			}
		}
		// 可选：会话转录索引（实验性）。会话由 Gateway 管理，需显式设 MEMORY_SESSION_PATH 指向 transcript JSON（如 .gateway/sessions/transcripts/xxx.json）
		if (process.env.MEMORY_INDEX_SESSION === "1" || process.env.MEMORY_INDEX_SESSION === "true") {
			const sessionPathRaw = process.env.MEMORY_SESSION_PATH?.trim();
			const sessionPath = sessionPathRaw ? resolve(sessionPathRaw) : undefined;
			if (sessionPath && existsSync(sessionPath)) {
				try {
					const raw = readFileSync(sessionPath, "utf-8");
					const messages = JSON.parse(raw) as Array<{ role?: string; content?: string }>;
					if (Array.isArray(messages)) {
						let lineNum = 1;
						for (const m of messages) {
							const role = m.role || "unknown";
							const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content || "");
							if (!text.trim()) continue;
							const line = `[${role}] ${text.slice(0, 2000)}`;
							db.run(
								"INSERT INTO chunks_fts(path, start_line, end_line, content) VALUES(?, ?, ?, ?)",
								"session/transcript.md",
								lineNum,
								lineNum,
								line,
							);
							lineNum += 1;
						}
					}
				} catch {
					// ignore
				}
			}
		}
		// 可选：向量 embedding 写入 chunk_embeddings
		if (isEmbeddingEnabled() && process.env.EMBEDDING_API_KEY?.trim()) {
			const rows = db.all("SELECT path, start_line, end_line, content FROM chunks_fts") as Array<{
				path: string;
				start_line: number;
				end_line: number;
				content: string;
			}>;
			for (const r of rows) {
				const emb = await getEmbedding(r.content);
				if (emb) {
					db.run(
						"INSERT INTO chunk_embeddings(path, start_line, end_line, content, embedding_json) VALUES(?, ?, ?, ?, ?)",
						r.path,
						r.start_line,
						r.end_line,
						r.content,
						JSON.stringify(emb),
					);
				}
			}
		}
		return { ok: true };
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return { ok: false, error: msg };
	}
}

async function searchFtsAsync(
	indexPath: string,
	query: string,
	maxResults: number,
): Promise<Array<{ path: string; startLine: number; endLine: number; snippet: string; score: number }> | null> {
	const mod = await loadSqlite();
	if (!mod) return null;
	try {
		const db = openIndexDbWithMod(indexPath, mod);
		const q = query.trim().replace(/'/g, "''");
		const rows = db.all(
			"SELECT path, start_line, end_line, snippet(chunks_fts, 3, '', '', '…', 64) AS snippet FROM chunks_fts WHERE chunks_fts MATCH ? LIMIT ?",
			q,
			maxResults,
		) as Array<{ path: string; start_line: number; end_line: number; snippet: string }>;
		return rows.map((r) => ({
			path: r.path,
			startLine: r.start_line,
			endLine: r.end_line,
			snippet: r.snippet || "",
			score: 1,
		}));
	} catch {
		return null;
	}
}
// --- 向量 embedding（OpenAI 兼容 API）---

function isEmbeddingEnabled(): boolean {
	return process.env.MEMORY_EMBEDDING_ENABLED === "1" || process.env.MEMORY_EMBEDDING_ENABLED === "true";
}

async function getEmbedding(text: string): Promise<number[] | null> {
	const apiKey = process.env.EMBEDDING_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();
	if (!apiKey) return null;
	const base = (process.env.EMBEDDING_BASE_URL?.trim() || DEFAULT_EMBEDDING_BASE).replace(/\/$/, "");
	const model = process.env.EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL;
	try {
		const res = await fetch(`${base}/embeddings`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
			body: JSON.stringify({ input: text.slice(0, 8000), model }),
		});
		if (!res.ok) return null;
		const data = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
		const emb = data?.data?.[0]?.embedding;
		return Array.isArray(emb) ? emb : null;
	} catch {
		return null;
	}
}

function cosineSimilarity(a: number[], b: number[]): number {
	if (a.length !== b.length || a.length === 0) return 0;
	let dot = 0;
	let na = 0;
	let nb = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		na += a[i] * a[i];
		nb += b[i] * b[i];
	}
	const norm = Math.sqrt(na) * Math.sqrt(nb);
	return norm === 0 ? 0 : dot / norm;
}

/** 从 DB 加载所有 chunk 的 embedding，返回 [{ path, startLine, endLine, content, embedding }]。 */
async function loadEmbeddingsAsync(indexPath: string): Promise<Array<{ path: string; startLine: number; endLine: number; content: string; embedding: number[] }> | null> {
	const mod = await loadSqlite();
	if (!mod) return null;
	try {
		const db = openIndexDbWithMod(indexPath, mod);
		const rows = db.all("SELECT path, start_line, end_line, content, embedding_json FROM chunk_embeddings WHERE embedding_json IS NOT NULL AND embedding_json != ''") as Array<{
			path: string;
			start_line: number;
			end_line: number;
			content: string;
			embedding_json: string;
		}>;
		const out: Array<{ path: string; startLine: number; endLine: number; content: string; embedding: number[] }> = [];
		for (const r of rows) {
			try {
				const emb = JSON.parse(r.embedding_json) as number[];
				if (Array.isArray(emb)) out.push({ path: r.path, startLine: r.start_line, endLine: r.end_line, content: r.content || "", embedding: emb });
			} catch {
				// skip
			}
		}
		return out;
	} catch {
		return null;
	}
}

/** 从索引读取 session 路径内容（session/transcript.md 等非磁盘文件）。 */
async function getSessionContentFromIndex(
	indexPath: string,
	relPath: string,
	from?: number,
	lines?: number,
): Promise<string | null> {
	const mod = await loadSqlite();
	if (!mod) return null;
	try {
		const db = openIndexDbWithMod(indexPath, mod);
		const pathSafe = relPath.replace(/'/g, "''");
		let sql = "SELECT start_line, end_line, content FROM chunks_fts WHERE path = ?";
		const args: unknown[] = [relPath];
		if (from !== undefined) {
			sql += " AND start_line >= ?";
			args.push(from);
		}
		sql += " ORDER BY start_line";
		if (lines !== undefined) {
			sql += " LIMIT ?";
			args.push(lines);
		}
		const rows = db.all(sql, ...args) as Array<{ start_line: number; end_line: number; content: string }>;
		return rows.map((r) => r.content).join("\n") || null;
	} catch {
		return null;
	}
}

/** 向量检索：query 取 embedding，与所有 chunk 算余弦相似度，取 top maxResults。 */
async function searchVectorAsync(
	indexPath: string,
	query: string,
	maxResults: number,
): Promise<Array<{ path: string; startLine: number; endLine: number; snippet: string; score: number }> | null> {
	const queryEmb = await getEmbedding(query);
	if (!queryEmb) return null;
	const chunks = await loadEmbeddingsAsync(indexPath);
	if (!chunks || chunks.length === 0) return null;
	const withScore = chunks.map((c) => ({ ...c, score: cosineSimilarity(queryEmb, c.embedding) }));
	withScore.sort((a, b) => b.score - a.score);
	return withScore.slice(0, maxResults).map((c) => ({
		path: c.path,
		startLine: c.startLine,
		endLine: c.endLine,
		snippet: c.content.slice(0, 300),
		score: c.score,
	}));
}

/** 混合合并：ftsResults 与 vectorResults 按 (path, startLine, endLine) 合并，权重 vectorWeight/textWeight。 */
function mergeHybrid(
	ftsResults: Array<{ path: string; startLine: number; endLine: number; snippet: string; score: number }>,
	vectorResults: Array<{ path: string; startLine: number; endLine: number; snippet: string; score: number }>,
	vectorWeight: number,
	textWeight: number,
	maxResults: number,
): Array<{ path: string; startLine: number; endLine: number; snippet: string; score: number }> {
	const key = (r: { path: string; startLine: number; endLine: number }) => `${r.path}:${r.startLine}:${r.endLine}`;
	const ftsMap = new Map(ftsResults.map((r) => [key(r), { ...r, ftsScore: 1 / (1 + ftsResults.indexOf(r)) }]));
	const vecMax = Math.max(...vectorResults.map((r) => r.score), 1e-9);
	const vecMap = new Map(vectorResults.map((r) => [key(r), { ...r, vecScore: Math.max(0, r.score / vecMax) }]));
	const merged = new Map<string, { path: string; startLine: number; endLine: number; snippet: string; score: number }>();
	for (const [k, v] of ftsMap) {
		const vec = vecMap.get(k);
		const score = textWeight * v.ftsScore + (vec ? vectorWeight * vec.vecScore : 0);
		merged.set(k, { path: v.path, startLine: v.startLine, endLine: v.endLine, snippet: v.snippet, score });
	}
	for (const [k, v] of vecMap) {
		if (merged.has(k)) continue;
		const score = vectorWeight * v.vecScore;
		merged.set(k, { path: v.path, startLine: v.startLine, endLine: v.endLine, snippet: v.snippet, score });
	}
	return [...merged.values()].sort((a, b) => b.score - a.score).slice(0, maxResults);
}

// --- 工具定义 ---

export const tools: AgentTool[] = [
	{
		name: "memory_search",
		description:
			"在工作区 MEMORY.md 与 memory/*.md 中按关键词搜索。回答关于过往决策、偏好、日期、人物或待办前应先调用此工具。若有 FTS5 索引则用全文检索，否则回退到文件扫描。",
		parameters: {
			type: "object",
			properties: {
				query: { type: "string", description: "搜索词或短语" },
				maxResults: { type: "number", description: "最多返回条数，默认 10" },
			},
			required: ["query"],
		},
	},
	{
		name: "memory_get",
		description: "按 path 与可选行范围读取记忆文件片段。在 memory_search 之后按需使用以控制上下文大小。仅允许 MEMORY.md、memory.md、memory/*.md 及 MEMORY_EXTRA_PATHS 内路径。",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string", description: "相对工作区的路径，如 MEMORY.md、memory/2025-02-10.md" },
				from: { type: "number", description: "起始行号（1-based）" },
				lines: { type: "number", description: "读取行数" },
			},
			required: ["path"],
		},
	},
	{
		name: "memory_store",
		description: "将一条持久记忆追加到 MEMORY.md 的 ## Store 区块或当日 memory/YYYY-MM-DD.md。用于「记住这个」类请求。",
		parameters: {
			type: "object",
			properties: {
				text: { type: "string", description: "要存储的记忆内容" },
				target: { type: "string", description: "longterm（写入 MEMORY.md）或 daily（写入当日 memory/YYYY-MM-DD.md），默认 longterm" },
			},
			required: ["text"],
		},
	},
	{
		name: "memory_recall",
		description: "与 memory_search 语义相同：在工作区记忆文件中搜索。回答与历史、决策、偏好相关的问题前可先调用 memory_recall 或 memory_search。",
		parameters: {
			type: "object",
			properties: {
				query: { type: "string", description: "搜索词或短语" },
				maxResults: { type: "number", description: "最多返回条数，默认 10" },
			},
			required: ["query"],
		},
	},
	{
		name: "memory_forget",
		description: "将一条「待遗忘」记录追加到 MEMORY.md 的 ## Forgotten 区块，供人工审阅或后续过滤。不删除原内容，仅做标记。",
		parameters: {
			type: "object",
			properties: {
				text: { type: "string", description: "要标记遗忘的内容或简述" },
			},
			required: ["text"],
		},
	},
	{
		name: "memory_sync",
		description: "重建 FTS5 全文索引（.first_paramecium/memory/index.sqlite）。在大量修改 MEMORY.md 或 memory/*.md 后调用可提升 memory_search 速度与准确性。需 Node 22+。",
		parameters: { type: "object", properties: {} },
	},
];

export async function executeTool(
	name: string,
	args: Record<string, unknown>,
): Promise<{ content: string; isError?: boolean }> {
	const workspaceDir = getWorkspaceDir();
	const indexPath = getIndexPath(workspaceDir);

	try {
		if (name === "memory_search" || name === "memory_recall") {
			const query = String(args?.query ?? "").trim();
			if (!query) return { content: "query is required", isError: true };
			const maxResults = Math.min(
				Math.max(1, Number(args?.maxResults) || DEFAULT_MAX_RESULTS),
				50,
			);
			const indexExists = existsSync(indexPath);
			const candidateLimit = Math.min(maxResults * 4, 50);
			const ftsResults = indexExists ? await searchFtsAsync(indexPath, query, candidateLimit) : null;
			const useHybrid = indexExists && isEmbeddingEnabled() && process.env.EMBEDDING_API_KEY?.trim();
			const vectorResults = useHybrid ? await searchVectorAsync(indexPath, query, candidateLimit) : null;
			if (ftsResults !== null || vectorResults !== null) {
				let results: Array<{ path: string; startLine: number; endLine: number; snippet: string; score: number }>;
				let provider: string;
				if (useHybrid && ftsResults && vectorResults && vectorResults.length > 0) {
					const vw = Math.max(0, Math.min(1, Number(process.env.MEMORY_VECTOR_WEIGHT) || 0.7));
					const tw = Math.max(0, Math.min(1, Number(process.env.MEMORY_TEXT_WEIGHT) || 0.3));
					results = mergeHybrid(ftsResults, vectorResults, vw, tw, maxResults);
					provider = "hybrid";
				} else if (ftsResults !== null && ftsResults.length > 0) {
					results = ftsResults.slice(0, maxResults);
					provider = "fts5";
				} else if (vectorResults !== null && vectorResults.length > 0) {
					results = vectorResults.slice(0, maxResults);
					provider = "vector";
				} else {
					results = (ftsResults || vectorResults || []).slice(0, maxResults);
					provider = vectorResults ? "vector" : "fts5";
				}
				return {
					content: JSON.stringify({
						results: results.map((r) => ({
							path: r.path,
							startLine: r.startLine,
							endLine: r.endLine,
							snippet: r.snippet,
							score: r.score,
						})),
						provider,
					}),
				};
			}
			const files = listMemoryFiles(workspaceDir);
			const all: Array<{ path: string; startLine: number; endLine: number; snippet: string; score: number }> = [];
			for (const { path: relPath, absPath } of files) {
				const hits = searchInFile(absPath, relPath, query, maxResults - all.length);
				all.push(...hits);
				if (all.length >= maxResults) break;
			}
			const results = all.slice(0, maxResults);
			return {
				content: JSON.stringify({
					results: results.map((r) => ({
						path: r.path,
						startLine: r.startLine,
						endLine: r.endLine,
						snippet: r.snippet,
						score: r.score,
					})),
					provider: "file-keyword",
				}),
			};
		}

		if (name === "memory_get") {
			const relPath = String(args?.path ?? "").trim();
			if (!relPath) return { content: "path is required", isError: true };
			if (!isMemoryPath(relPath, workspaceDir)) {
				return { content: `path not allowed: ${relPath} (only MEMORY.md, memory.md, memory/*.md, session/*.md or MEMORY_EXTRA_PATHS)`, isError: true };
			}
			const from = typeof args?.from === "number" ? Math.max(1, Math.floor(args.from)) : undefined;
			const lines = typeof args?.lines === "number" ? Math.max(1, Math.floor(args.lines)) : undefined;
			if (relPath.startsWith("session/") && existsSync(indexPath)) {
				const text = await getSessionContentFromIndex(indexPath, relPath, from, lines);
				if (text !== null) return { content: JSON.stringify({ path: relPath, text }) };
			}
			const absPath = resolve(workspaceDir, relPath);
			if (!absPath.startsWith(resolve(workspaceDir)) || relPath.includes("..")) {
				return { content: "path must be within workspace", isError: true };
			}
			if (!existsSync(absPath)) return { content: `File not found: ${relPath}`, isError: true };
			let text = readFileSync(absPath, "utf-8");
			const lineList = text.split(/\r?\n/);
			if (from !== undefined || lines !== undefined) {
				const start = (from ?? 1) - 1;
				const count = lines ?? lineList.length - start;
				const slice = lineList.slice(start, start + count);
				text = slice.join("\n");
			}
			return { content: JSON.stringify({ path: relPath, text }) };
		}

		if (name === "memory_store") {
			const text = String(args?.text ?? "").trim();
			if (!text) return { content: "text is required", isError: true };
			const target = (String(args?.target ?? "longterm").trim().toLowerCase() === "daily") ? "daily" : "longterm";
			const today = new Date().toISOString().slice(0, 10);
			if (target === "daily") {
				const dir = join(workspaceDir, "memory");
				if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
				const filePath = join(dir, `${today}.md`);
				const line = `\n- ${new Date().toISOString()} ${text}\n`;
				appendFileSync(filePath, line);
				return { content: JSON.stringify({ ok: true, path: `memory/${today}.md`, target: "daily" }) };
			}
			const memoryPath = join(workspaceDir, "MEMORY.md");
			let content = existsSync(memoryPath) ? readFileSync(memoryPath, "utf-8") : "";
			const marker = "## Store";
			if (!content.includes(marker)) {
				content += (content ? "\n\n" : "") + `${marker}\n\n`;
			}
			const storeLine = `- ${new Date().toISOString()} ${text}\n`;
			content += storeLine;
			const { writeFileSync } = await import("node:fs");
			writeFileSync(memoryPath, content);
			return { content: JSON.stringify({ ok: true, path: "MEMORY.md", target: "longterm" }) };
		}

		if (name === "memory_forget") {
			const text = String(args?.text ?? "").trim();
			if (!text) return { content: "text is required", isError: true };
			const memoryPath = join(workspaceDir, "MEMORY.md");
			let content = existsSync(memoryPath) ? readFileSync(memoryPath, "utf-8") : "";
			const marker = "## Forgotten";
			if (!content.includes(marker)) {
				content += (content ? "\n\n" : "") + `${marker}\n\n`;
			}
			content += `- ${new Date().toISOString()} ${text}\n`;
			const { writeFileSync } = await import("node:fs");
			writeFileSync(memoryPath, content);
			return { content: JSON.stringify({ ok: true, path: "MEMORY.md" }) };
		}

		if (name === "memory_sync") {
			const result = await runSyncAsync(workspaceDir);
			if (result.ok) {
				return { content: JSON.stringify({ ok: true, indexPath }) };
			}
			return { content: JSON.stringify({ ok: false, error: result.error }), isError: true };
		}

		return { content: `Unknown tool: ${name}`, isError: true };
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		return { content: message, isError: true };
	}
}
