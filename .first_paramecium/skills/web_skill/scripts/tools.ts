/**
 * Web skill: web_fetch, web_search.
 * web_search uses SERPER_API_KEY or TAVILY_API_KEY (optional).
 * For JS-rendered pages (SPA), use browser_skill's browser_fetch_js (requires Browser Node).
 */

import type { AgentTool } from "@monou/agent-core";

const MAX_FETCH_LENGTH = 80_000;
const FETCH_TIMEOUT_MS = 15_000;

function stripHtml(html: string): string {
	return html
		.replace(/<script[\s\S]*?<\/script>/gi, "")
		.replace(/<style[\s\S]*?<\/style>/gi, "")
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

export const tools: AgentTool[] = [
	{
		name: "web_fetch",
		description: "拉取指定 URL 的页面内容并返回纯文本（去除 HTML 标签）。",
		parameters: {
			type: "object",
			properties: { url: { type: "string", description: "要拉取的 URL" } },
			required: ["url"],
		},
	},
	{
		name: "web_search",
		description: "在网络上搜索并返回摘要与链接。需要环境变量 SERPER_API_KEY 或 TAVILY_API_KEY。",
		parameters: {
			type: "object",
			properties: { query: { type: "string", description: "搜索关键词或问句" } },
			required: ["query"],
		},
	},
];

export async function executeTool(
	name: string,
	args: Record<string, unknown>,
): Promise<{ content: string; isError?: boolean }> {
	try {
		if (name === "web_fetch") {
			const url = String(args.url ?? "").trim();
			if (!url) return { content: "url is required", isError: true };
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
			const res = await fetch(url, {
				signal: controller.signal,
				headers: { "User-Agent": "monoU-web_fetch/1.0" },
		 });
			clearTimeout(timeout);
			if (!res.ok) return { content: `HTTP ${res.status}: ${url}`, isError: true };
			const html = await res.text();
			const text = stripHtml(html);
			const out = text.length > MAX_FETCH_LENGTH ? text.slice(0, MAX_FETCH_LENGTH) + "\n\n[truncated]" : text;
			return { content: out || "(no text content)" };
		}
		if (name === "web_search") {
			const query = String(args.query ?? "").trim();
			if (!query) return { content: "query is required", isError: true };
			const serperKey = process.env.SERPER_API_KEY?.trim();
			const tavilyKey = process.env.TAVILY_API_KEY?.trim();
			if (serperKey) {
				const res = await fetch("https://google.serper.dev/search", {
					method: "POST",
					headers: { "X-API-KEY": serperKey, "Content-Type": "application/json" },
					body: JSON.stringify({ q: query, num: 8 }),
				});
				if (!res.ok) return { content: `Serper API error: ${res.status}`, isError: true };
				const data = (await res.json()) as { organic?: Array<{ title?: string; link?: string; snippet?: string }> };
				const items = data.organic ?? [];
				const lines = items.slice(0, 8).map((o, i) => `${i + 1}. ${o.title ?? ""}\n   ${o.link ?? ""}\n   ${o.snippet ?? ""}`);
				return { content: lines.join("\n\n") || "No results." };
			}
			if (tavilyKey) {
				const res = await fetch("https://api.tavily.com/search", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ api_key: tavilyKey, query, search_depth: "basic", max_results: 8 }),
				});
				if (!res.ok) return { content: `Tavily API error: ${res.status}`, isError: true };
				const data = (await res.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> };
				const items = data.results ?? [];
				const lines = items.slice(0, 8).map((o, i) => `${i + 1}. ${o.title ?? ""}\n   ${o.url ?? ""}\n   ${o.content ?? ""}`);
				return { content: lines.join("\n\n") || "No results." };
			}
			return { content: "web_search requires SERPER_API_KEY or TAVILY_API_KEY in environment.", isError: true };
		}
		return { content: `Unknown tool: ${name}`, isError: true };
	} catch (e) {
		return { content: e instanceof Error ? e.message : String(e), isError: true };
	}
}
