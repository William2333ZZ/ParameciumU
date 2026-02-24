/**
 * Knowledge skill：knowledge_search、knowledge_get、knowledge_sync、knowledge_add。
 * 工作区默认 ./.u（KNOWLEDGE.md、knowledge/*.md），或 KNOWLEDGE_WORKSPACE。
 * 可选 FTS5 索引（Node 22+ node:sqlite）存于 .u/knowledge/index.sqlite；可选向量混合检索（EMBEDDING_API_KEY）。
 */

import type { AgentTool } from "@monou/agent-core";
import { readFileSync, existsSync, readdirSync, mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const DEFAULT_MAX_RESULTS = 10;
const INDEX_DIR = "knowledge";
const INDEX_FILENAME = "index.sqlite";
const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_EMBEDDING_BASE = "https://api.openai.com/v1";

function getWorkspaceDir(): string {
	const env = process.env.KNOWLEDGE_WORKSPACE?.trim();
	if (env) return resolve(env);
	return join(process.cwd(), ".u");
}

function getIndexPath(workspaceDir: string): string {
	const env = process.env.KNOWLEDGE_INDEX_PATH?.trim();
	if (env) return resolve(env);
	return join(workspaceDir, INDEX_DIR, INDEX_FILENAME);
}

function getExtraPaths(workspaceDir: string): string[] {
	const raw = process.env.KNOWLEDGE_EXTRA_PATHS?.trim();
	if (!raw) return [];
	return raw.split(",").map((p) => p.trim()).filter(Boolean);
}

function isKnowledgePath(relPath: string, workspaceDir: string): boolean {
	const normalized = relPath.replace(/\\/g, "/");
	if (normalized === "KNOWLEDGE.md" || normalized === "knowledge.md") return true;
	if (normalized.startsWith("knowledge/") && normalized.endsWith(".md")) return true;
	const extra = getExtraPaths(workspaceDir);
	for (const p of extra) {
		const abs = p.startsWith("/") ? p : join(workspaceDir, p);
		const rel = resolve(workspaceDir, normalized);
		if (resolve(abs) === rel || rel.startsWith(resolve(abs) + "/")) return true;
	}
	return false;
}

/** 路径安全：禁止 .. 与反斜杠，用于 topic/知识点 作为路径片段。 */
function safePathSegment(segment: string): string {
	const s = segment.replace(/\\/g, "/").trim();
	if (s.includes("..") || s.startsWith("/")) return "";
	return s;
}

/** 将内容追加到 knowledge/<topic>/<point>.md 或 knowledge/<topic>/learned.md 或 KNOWLEDGE.md。 */
function appendToTopicPoint(
	workspaceDir: string,
	topic: string | undefined,
	point: string | undefined,
	text: string,
	source?: string,
): { ok: boolean; path: string } {
	const line = source
		? `\n- ${new Date().toISOString()} [${source}]\n\n${text}\n`
		: `\n- ${new Date().toISOString()} ${text}\n`;
	if (topic) {
		const knowDir = join(workspaceDir, "knowledge", topic);
		const fileName = point ? (point.endsWith(".md") ? point : `${point}.md`) : "learned.md";
		const absPath = join(knowDir, fileName);
		const dir = resolve(absPath, "..");
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
		appendFileSync(absPath, line);
		const relPath = point ? `knowledge/${topic}/${fileName}` : `knowledge/${topic}/learned.md`;
		return { ok: true, path: relPath };
	}
	const mainPath = join(workspaceDir, "KNOWLEDGE.md");
	let content = existsSync(mainPath) ? readFileSync(mainPath, "utf-8") : "";
	const marker = "## Add";
	if (!content.includes(marker)) {
		content += (content ? "\n\n" : "") + `${marker}\n\n`;
	}
	content += line.trimStart();
	writeFileSync(mainPath, content);
	return { ok: true, path: "KNOWLEDGE.md" };
}

/** 简单 HTML 转纯文本：去 script/style，再去标签。 */
function stripHtmlToText(html: string): string {
	let s = html
		.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
		.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
	s = s.replace(/<[^>]+>/g, " ");
	s = s.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
	return s.replace(/\s+/g, " ").trim();
}

/** 递归收集目录下所有 .md 文件，relBase 为相对工作区的路径前缀。 */
function listMdRecursive(absDir: string, relBase: string, out: { path: string; absPath: string }[]): void {
	try {
		const names = readdirSync(absDir, { withFileTypes: true });
		for (const d of names) {
			const abs = join(absDir, d.name);
			const rel = relBase ? `${relBase}/${d.name}` : d.name;
			if (d.isFile() && d.name.endsWith(".md")) {
				out.push({ path: rel, absPath: abs });
			} else if (d.isDirectory() && !d.name.startsWith(".")) {
				listMdRecursive(abs, rel, out);
			}
		}
	} catch {
		// ignore
	}
}

/** 当 topic 存在时，仅保留 path 为 knowledge/<topic>.md 或 knowledge/<topic>/ 下的项（topic 为文件夹或单文件）。 */
function filterFilesByTopic(files: { path: string; absPath: string }[], topic: string): { path: string; absPath: string }[] {
	const t = safePathSegment(topic);
	if (!t) return files;
	const norm = (p: string) => p.replace(/\\/g, "/");
	return files.filter((f) => {
		const p = norm(f.path);
		if (p === `knowledge/${t}.md`) return true;
		if (p.startsWith(`knowledge/${t}/`) && p.endsWith(".md")) return true;
		return false;
	});
}

function listKnowledgeFiles(workspaceDir: string, topic?: string): { path: string; absPath: string }[] {
	const out: { path: string; absPath: string }[] = [];
	const root = ["KNOWLEDGE.md", "knowledge.md"];
	for (const name of root) {
		const abs = join(workspaceDir, name);
		if (existsSync(abs)) out.push({ path: name, absPath: abs });
	}
	const knowDir = join(workspaceDir, "knowledge");
	if (existsSync(knowDir)) {
		try {
			const names = readdirSync(knowDir, { withFileTypes: true });
			for (const d of names) {
				const abs = join(knowDir, d.name);
				const rel = join("knowledge", d.name);
				if (d.isFile() && d.name.endsWith(".md")) {
					out.push({ path: rel, absPath: abs });
				} else if (d.isDirectory() && !d.name.startsWith(".")) {
					listMdRecursive(abs, rel, out);
				}
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
	if (topic != null && topic.trim() !== "") return filterFilesByTopic(out, topic);
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
	const pattern = q ? new RegExp(escapeRe(q), "gi") : null;
	for (let i = 0; i < lines.length && results.length < maxResults; i++) {
		const line = lines[i];
		if (!pattern) continue;
		if (!pattern.test(line)) continue;
		const snippet = line.trim().slice(0, 500);
		results.push({ path: relPath, startLine: i + 1, endLine: i + 1, snippet, score: 1 });
	}
	return results;
}

// --- FTS5 ---

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
		const files = listKnowledgeFiles(workspaceDir);
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

/** topic 作为文件夹或单文件：exact = knowledge/<topic>.md，prefix = knowledge/<topic>/（用于 LIKE，需转义 % _） */
function topicToPathPattern(topic: string): { exact: string; prefix: string; prefixLike: string } {
	const t = safePathSegment(topic) || topic.trim().replace(/\\/g, "/");
	const exact = `knowledge/${t}.md`;
	const prefix = `knowledge/${t}/`;
	const prefixLike = "knowledge/" + t.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_") + "/";
	return { exact, prefix, prefixLike };
}

async function searchFtsAsync(
	indexPath: string,
	query: string,
	maxResults: number,
	topic?: string,
): Promise<Array<{ path: string; startLine: number; endLine: number; snippet: string; score: number }> | null> {
	const mod = await loadSqlite();
	if (!mod) return null;
	try {
		const db = openIndexDbWithMod(indexPath, mod);
		const q = query.trim().replace(/'/g, "''");
		let sql: string;
		let args: unknown[];
		if (topic != null && topic.trim() !== "") {
			const { exact, prefixLike } = topicToPathPattern(topic);
			sql = "SELECT path, start_line, end_line, snippet(chunks_fts, 3, '', '', '…', 64) AS snippet FROM chunks_fts WHERE chunks_fts MATCH ? AND (path = ? OR path LIKE ? ESCAPE '\\') LIMIT ?";
			args = [q, exact, prefixLike + "%", maxResults];
		} else {
			sql = "SELECT path, start_line, end_line, snippet(chunks_fts, 3, '', '', '…', 64) AS snippet FROM chunks_fts WHERE chunks_fts MATCH ? LIMIT ?";
			args = [q, maxResults];
		}
		const rows = db.all(sql, ...args) as Array<{ path: string; start_line: number; end_line: number; snippet: string }>;
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

function isEmbeddingEnabled(): boolean {
	return process.env.KNOWLEDGE_EMBEDDING_ENABLED === "1" || process.env.KNOWLEDGE_EMBEDDING_ENABLED === "true";
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
	let dot = 0, na = 0, nb = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		na += a[i] * a[i];
		nb += b[i] * b[i];
	}
	const norm = Math.sqrt(na) * Math.sqrt(nb);
	return norm === 0 ? 0 : dot / norm;
}

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

async function searchVectorAsync(
	indexPath: string,
	query: string,
	maxResults: number,
	topic?: string,
): Promise<Array<{ path: string; startLine: number; endLine: number; snippet: string; score: number }> | null> {
	const queryEmb = await getEmbedding(query);
	if (!queryEmb) return null;
	let chunks = await loadEmbeddingsAsync(indexPath);
	if (!chunks || chunks.length === 0) return null;
	if (topic != null && topic.trim() !== "") {
		const { exact, prefix } = topicToPathPattern(topic);
		chunks = chunks.filter((c) => c.path === exact || c.path.startsWith(prefix));
	}
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
		merged.set(k, { path: v.path, startLine: v.startLine, endLine: v.endLine, snippet: v.snippet, score: vectorWeight * v.vecScore });
	}
	return [...merged.values()].sort((a, b) => b.score - a.score).slice(0, maxResults);
}

// --- 工具定义 ---

export const tools: AgentTool[] = [
	{
		name: "knowledge_search",
		description:
			"在工作区 KNOWLEDGE.md 与 knowledge/*.md 中按关键词搜索。可选 topic 时仅在该主题（如 stock、faq）对应文件中检索。回答根据文档/知识库/FAQ 类问题前应先调用此工具。若有 FTS5 索引则用全文检索，否则回退到文件扫描。",
		parameters: {
			type: "object",
			properties: {
				query: { type: "string", description: "搜索词或短语" },
				topic: { type: "string", description: "可选，仅在该主题下检索，如 stock、faq，对应 knowledge/<topic>.md" },
				maxResults: { type: "number", description: "最多返回条数，默认 10" },
			},
			required: ["query"],
		},
	},
	{
		name: "knowledge_get",
		description: "按 path 与可选行范围读取知识库文件片段。在 knowledge_search 之后按需使用。仅允许 KNOWLEDGE.md、knowledge.md、knowledge/*.md 及 KNOWLEDGE_EXTRA_PATHS 内路径。",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string", description: "相对工作区的路径，如 KNOWLEDGE.md、knowledge/faq.md" },
				from: { type: "number", description: "起始行号（1-based）" },
				lines: { type: "number", description: "读取行数" },
			},
			required: ["path"],
		},
	},
	{
		name: "knowledge_sync",
		description: "重建 FTS5 全文索引（.u/knowledge/index.sqlite）。在大量修改 KNOWLEDGE.md 或 knowledge/*.md 后调用可提升 knowledge_search 速度与准确性。需 Node 22+。",
		parameters: { type: "object", properties: {} },
	},
	{
		name: "knowledge_add",
		description: "将一条知识追加到 KNOWLEDGE.md 的 ## Add 区块或指定 knowledge/<topic>.md。用于「把这条记进知识库」。",
		parameters: {
			type: "object",
			properties: {
				text: { type: "string", description: "要存储的知识内容" },
				path: { type: "string", description: "可选，如 knowledge/faq.md；不传则追加到 KNOWLEDGE.md 的 ## Add" },
			},
			required: ["text"],
		},
	},
	{
		name: "knowledge_learn",
		description: "自学习：将一段文本写入知识库。topic 为文件夹（如 股票、高中数学），知识点为子路径（如 K线、函数、几何/解析几何）。有 topic+知识点 则写入 knowledge/<topic>/<知识点>.md，仅 topic 则追加到 knowledge/<topic>/learned.md，否则 KNOWLEDGE.md。学习后建议 knowledge_sync。",
		parameters: {
			type: "object",
			properties: {
				text: { type: "string", description: "要学习的文本内容" },
				topic: { type: "string", description: "可选，主题（文件夹名），如 股票、高中数学" },
				point: { type: "string", description: "可选，知识点（子路径），如 K线、函数、技术分析/形态" },
				source: { type: "string", description: "可选，来源标记，如 url 或 conversation" },
			},
			required: ["text"],
		},
	},
	{
		name: "knowledge_list_topics",
		description: "列出当前知识库中的主题：knowledge/ 下的 .md 文件名（去掉 .md）与子目录名。如 股票、高中数学、faq。便于选择 topic 或决定是否将某类知识转为 Skill。",
		parameters: { type: "object", properties: {} },
	},
	{
		name: "knowledge_list_points",
		description: "列出某主题下的知识点（knowledge/<topic>/ 下的文件名与子目录名）。如 topic=股票 返回 [K线, 基本面, 技术分析]。用于了解该主题下已有结构。",
		parameters: {
			type: "object",
			properties: {
				topic: { type: "string", description: "主题名（文件夹），如 股票、高中数学" },
			},
			required: ["topic"],
		},
	},
	{
		name: "knowledge_learn_from_urls",
		description: "从指定 URL 抓取页面内容并写入知识库（可指定 topic/知识点）。用于自主学习：先 web_search 获取链接，再调用本工具将内容沉淀到知识库。",
		parameters: {
			type: "object",
			properties: {
				urls: { type: "array", items: { type: "string" }, description: "要抓取的 URL 列表" },
				topic: { type: "string", description: "可选，主题（文件夹），如 股票、高中数学" },
				point: { type: "string", description: "可选，知识点（子路径），如 K线" },
				maxContentPerUrl: { type: "number", description: "可选，每个 URL 最多取字符数，默认 30000" },
			},
			required: ["urls"],
		},
	},
	{
		name: "knowledge_skill_create",
		description: "将某一主题的知识转化为 Skill。创建 .u/skills/<topic>_knowledge/，之后 run 会自动注册 <topic>_knowledge_search，仅在该主题知识库中检索。例如 topic=stock 则创建 stock_knowledge，用于股票类问题。",
		parameters: {
			type: "object",
			properties: {
				topic: { type: "string", description: "主题名，如 stock、faq，将生成 <topic>_knowledge 目录" },
				description: { type: "string", description: "可选，Skill 描述，如「股票、行情、K 线、基本面」" },
			},
			required: ["topic"],
		},
	},
];

export async function executeTool(
	name: string,
	args: Record<string, unknown>,
): Promise<{ content: string; isError?: boolean }> {
	const workspaceDir = getWorkspaceDir();
	const indexPath = getIndexPath(workspaceDir);

	try {
		if (name === "knowledge_search") {
			const query = String(args?.query ?? "").trim();
			if (!query) return { content: "query is required", isError: true };
			const topic = typeof args?.topic === "string" ? args.topic.trim() : undefined;
			const maxResults = Math.min(
				Math.max(1, Number(args?.maxResults) || DEFAULT_MAX_RESULTS),
				50,
			);
			const indexExists = existsSync(indexPath);
			const candidateLimit = Math.min(maxResults * 4, 50);
			const ftsResults = indexExists ? await searchFtsAsync(indexPath, query, candidateLimit, topic) : null;
			const useHybrid = indexExists && isEmbeddingEnabled() && process.env.EMBEDDING_API_KEY?.trim();
			const vectorResults = useHybrid ? await searchVectorAsync(indexPath, query, candidateLimit, topic) : null;
			if (ftsResults !== null || vectorResults !== null) {
				let results: Array<{ path: string; startLine: number; endLine: number; snippet: string; score: number }>;
				let provider: string;
				if (useHybrid && ftsResults && vectorResults && vectorResults.length > 0) {
					const vw = Math.max(0, Math.min(1, Number(process.env.KNOWLEDGE_VECTOR_WEIGHT) || 0.7));
					const tw = Math.max(0, Math.min(1, Number(process.env.KNOWLEDGE_TEXT_WEIGHT) || 0.3));
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
						topic: topic ?? null,
					}),
				};
			}
			const files = listKnowledgeFiles(workspaceDir, topic);
			const all: Array<{ path: string; startLine: number; endLine: number; snippet: string; score: number }> = [];
			for (const { path: relPath, absPath } of files) {
				const hits = searchInFile(absPath, relPath, query, maxResults - all.length);
				all.push(...hits);
				if (all.length >= maxResults) break;
			}
			return {
				content: JSON.stringify({
					results: all.slice(0, maxResults).map((r) => ({
						path: r.path,
						startLine: r.startLine,
						endLine: r.endLine,
						snippet: r.snippet,
						score: r.score,
					})),
					provider: "file-keyword",
					topic: topic ?? null,
				}),
			};
		}

		if (name === "knowledge_get") {
			const relPath = String(args?.path ?? "").trim();
			if (!relPath) return { content: "path is required", isError: true };
			if (!isKnowledgePath(relPath, workspaceDir)) {
				return { content: `path not allowed: ${relPath} (only KNOWLEDGE.md, knowledge.md, knowledge/*.md or KNOWLEDGE_EXTRA_PATHS)`, isError: true };
			}
			const from = typeof args?.from === "number" ? Math.max(1, Math.floor(args.from)) : undefined;
			const lines = typeof args?.lines === "number" ? Math.max(1, Math.floor(args.lines)) : undefined;
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
				text = lineList.slice(start, start + count).join("\n");
			}
			return { content: JSON.stringify({ path: relPath, text }) };
		}

		if (name === "knowledge_add") {
			const text = String(args?.text ?? "").trim();
			if (!text) return { content: "text is required", isError: true };
			const relPath = String(args?.path ?? "").trim();
			if (relPath) {
				if (!isKnowledgePath(relPath, workspaceDir)) {
					return { content: `path not allowed: ${relPath}`, isError: true };
				}
				const absPath = resolve(workspaceDir, relPath);
				if (!absPath.startsWith(resolve(workspaceDir)) || relPath.includes("..")) {
					return { content: "path must be within workspace", isError: true };
				}
				const dir = resolve(absPath, "..");
				if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
				const line = `\n- ${new Date().toISOString()} ${text}\n`;
				appendFileSync(absPath, line);
				return { content: JSON.stringify({ ok: true, path: relPath }) };
			}
			const mainPath = join(workspaceDir, "KNOWLEDGE.md");
			let content = existsSync(mainPath) ? readFileSync(mainPath, "utf-8") : "";
			const marker = "## Add";
			if (!content.includes(marker)) {
				content += (content ? "\n\n" : "") + `${marker}\n\n`;
			}
			content += `- ${new Date().toISOString()} ${text}\n`;
			writeFileSync(mainPath, content);
			return { content: JSON.stringify({ ok: true, path: "KNOWLEDGE.md" }) };
		}

		if (name === "knowledge_sync") {
			const result = await runSyncAsync(workspaceDir);
			if (result.ok) {
				return { content: JSON.stringify({ ok: true, indexPath }) };
			}
			return { content: JSON.stringify({ ok: false, error: result.error }), isError: true };
		}

		if (name === "knowledge_learn") {
			const text = String(args?.text ?? "").trim();
			if (!text) return { content: "text is required", isError: true };
			const topic = typeof args?.topic === "string" ? safePathSegment(args.topic) || args.topic.trim() : undefined;
			const point = typeof args?.point === "string" ? safePathSegment(args.point) || args.point.trim().replace(/\\/g, "/") : undefined;
			const source = typeof args?.source === "string" ? args.source.trim() : undefined;
			const written = appendToTopicPoint(workspaceDir, topic, point, text, source);
			return { content: JSON.stringify(written) };
		}

		if (name === "knowledge_list_topics") {
			const knowDir = join(workspaceDir, "knowledge");
			const topics: string[] = [];
			if (existsSync(knowDir)) {
				try {
					const entries = readdirSync(knowDir, { withFileTypes: true });
					for (const e of entries) {
						if (e.isFile() && e.name.endsWith(".md")) topics.push(e.name.slice(0, -3));
						else if (e.isDirectory() && !e.name.startsWith(".")) topics.push(e.name);
					}
				} catch {
					// ignore
				}
			}
			topics.sort();
			return { content: JSON.stringify({ topics }) };
		}

		if (name === "knowledge_list_points") {
			const topic = typeof args?.topic === "string" ? safePathSegment(args.topic) || args.topic.trim() : "";
			if (!topic) return { content: "topic is required", isError: true };
			const topicDir = join(workspaceDir, "knowledge", topic);
			const points: string[] = [];
			if (existsSync(topicDir)) {
				try {
					const entries = readdirSync(topicDir, { withFileTypes: true });
					for (const e of entries) {
						if (e.isFile() && e.name.endsWith(".md")) points.push(e.name.slice(0, -3));
						else if (e.isDirectory() && !e.name.startsWith(".")) points.push(e.name + "/");
					}
				} catch {
					// ignore
				}
			}
			points.sort();
			return { content: JSON.stringify({ topic, points }) };
		}

		if (name === "knowledge_learn_from_urls") {
			const urlsRaw = args?.urls;
			const urls = Array.isArray(urlsRaw) ? urlsRaw.map((u) => String(u).trim()).filter(Boolean) : [];
			if (urls.length === 0) return { content: "urls (array of URLs) is required", isError: true };
			const topic = typeof args?.topic === "string" ? safePathSegment(args.topic) || args.topic.trim() : undefined;
			const point = typeof args?.point === "string" ? safePathSegment(args.point) || args.point.trim().replace(/\\/g, "/") : undefined;
			const maxPerUrl = Math.min(50000, Math.max(1000, Number(args?.maxContentPerUrl) || 30000));
			const results: { url: string; ok: boolean; chars?: number; error?: string }[] = [];
			for (const url of urls) {
				try {
					const res = await fetch(url, {
						headers: { "User-Agent": "monoU-knowledge-learn/1.0" },
						signal: AbortSignal.timeout(15000),
					});
					if (!res.ok) {
						results.push({ url, ok: false, error: `HTTP ${res.status}` });
						continue;
					}
					const html = await res.text();
					const text = stripHtmlToText(html).slice(0, maxPerUrl);
					if (!text.trim()) {
						results.push({ url, ok: false, error: "empty content" });
						continue;
					}
					appendToTopicPoint(workspaceDir, topic, point, text, url);
					results.push({ url, ok: true, chars: text.length });
				} catch (e) {
					results.push({ url, ok: false, error: e instanceof Error ? e.message : String(e) });
				}
			}
			return { content: JSON.stringify({ ok: true, results }) };
		}

		if (name === "knowledge_skill_create") {
			const topic = safePathSegment(String(args?.topic ?? "").trim()) || String(args?.topic ?? "").trim();
			if (!topic) return { content: "topic is required", isError: true };
			const skillDirName = `${topic}_knowledge`;
			// 技能目录必须在 agent 工作区内：workspaceDir 即 .u（agent 目录），skills 应在其下
			const skillDir = join(workspaceDir, "skills", skillDirName);
			if (existsSync(skillDir)) {
				return { content: JSON.stringify({ ok: false, error: `Skill already exists: ${skillDirName}` }), isError: true };
			}
			mkdirSync(skillDir, { recursive: true });
			const description = typeof args?.description === "string" ? String(args.description).trim() : "";
			const skillDesc = description || topic;
			const skillMd = `---
name: ${skillDirName}
description: "在「${skillDesc}」知识库中检索。由 knowledge_skill_create 生成；仅在该主题下搜索。"
---

# ${skillDirName}

当用户询问与 **${skillDesc}** 相关的问题时，使用 **${topic}_knowledge_search** 在本主题知识库中搜索，再按需 knowledge_get 拉取片段。

## 何时使用

- 用户问题涉及：${skillDesc}。
- 先调用 \`${topic}_knowledge_search\`（仅在本主题知识库中搜），再按需 \`knowledge_get\`。

## 工具

- **${topic}_knowledge_search(query, maxResults?)**：仅在 knowledge/${topic}/ 等本主题目录下检索。
`;
			writeFileSync(join(skillDir, "SKILL.md"), skillMd);
			const topicJson = JSON.stringify({ topic, description: skillDesc }, null, 2);
			writeFileSync(join(skillDir, "topic.json"), topicJson);
			return { content: JSON.stringify({ ok: true, skillDir: skillDirName, topic, tool: `${topic}_knowledge_search` }) };
		}

		return { content: `Unknown tool: ${name}`, isError: true };
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		return { content: message, isError: true };
	}
}
