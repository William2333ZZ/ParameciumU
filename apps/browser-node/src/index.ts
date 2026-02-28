#!/usr/bin/env node
/**
 * Browser Node：以 role=node 连接 Gateway，声明 capabilities: ["browser"]，
 * 用 Playwright WebKit 执行 browser_fetch（及后续会话类 command），供 node.invoke 调用。
 *
 * 用法:
 *   GATEWAY_URL=ws://127.0.0.1:9347 BROWSER_NODE_ID=browser-1 node dist/index.js
 *
 * 环境变量:
 *   GATEWAY_URL             Gateway WebSocket 地址（必填）
 *   BROWSER_NODE_ID         本节点 ID，用于 node.list / node.invoke 目标（默认 browser-1）
 *   BROWSER_HEADED          设为 1 时有头模式（可见窗口），默认无头
 *   BROWSER_USER_DATA_DIR   可选，浏览器 profile 持久化目录（cookie/登录态保留）
 *   VNC_PORT                可选，noVNC 端口（connect 时上报）；主流程用 CDP/截图，Control UI 以截图展示
 *   GATEWAY_TOKEN / GATEWAY_PASSWORD  可选认证
 *
 * 命令: browser_fetch（可选 captureScreenshot）、browser_screenshot（返回最近一次截图，供 Control UI / 自动化测试查看）
 */

import "dotenv/config";
import path from "node:path";
import process from "node:process";
import { type Browser, type BrowserContext, type Page, webkit } from "playwright";
import WebSocket from "ws";

const GATEWAY_URL = process.env.GATEWAY_WS_URL?.trim() || process.env.GATEWAY_URL?.trim();
const NODE_ID = process.env.BROWSER_NODE_ID?.trim() || "browser-1";
const HEADED = process.env.BROWSER_HEADED?.trim() === "1";
const USER_DATA_DIR = process.env.BROWSER_USER_DATA_DIR?.trim()
	? path.resolve(process.env.BROWSER_USER_DATA_DIR)
	: undefined;
const TOKEN = process.env.GATEWAY_TOKEN?.trim();
const PASSWORD = process.env.GATEWAY_PASSWORD?.trim();
const VNC_PORT = (() => {
	const v = process.env.VNC_PORT?.trim();
	if (!v) return undefined;
	const n = parseInt(v, 10);
	return Number.isFinite(n) && n > 0 && n < 65536 ? n : undefined;
})();

const MAX_FETCH_LENGTH = 80_000;
const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

/** 最近一次页面截图（browser_fetch 带 captureScreenshot 或 browser_screenshot 写入），供 Control UI / 自动化查看 */
let lastScreenshotBase64: string | null = null;
let lastScreenshotUrl: string | null = null;

/** 串行化 browser_fetch：同一时间只跑一个，避免多实例并发导致 WebKit 崩溃或 OOM 断线 */
let fetchInProgress = false;

/** 常驻浏览器：不每次关闭，便于登录态保留与后续切换 tab */
let persistentContext: BrowserContext | null = null;
let persistentBrowser: Browser | null = null;
let currentPage: Page | null = null;

if (!GATEWAY_URL) {
	console.error("需要设置 GATEWAY_URL 或 GATEWAY_WS_URL（可在 .env）");
	console.error("示例: GATEWAY_URL=ws://127.0.0.1:9347 BROWSER_NODE_ID=browser-1 npm run browser-node");
	process.exit(1);
}

process.on("unhandledRejection", (reason, promise) => {
	console.error("[browser-node] unhandledRejection:", reason);
});

function toUtf8String(data: Buffer | ArrayBuffer): string {
	if (typeof data === "string") return data;
	if (data instanceof Buffer) return data.toString("utf8");
	return Buffer.from(new Uint8Array(data)).toString("utf8");
}

type NodeInvokePayload = {
	id?: string;
	nodeId?: string;
	command?: string;
	params?: Record<string, unknown>;
	paramsJSON?: string | null;
	timeoutMs?: number | null;
};

function parsePayload(raw: unknown): NodeInvokePayload | null {
	if (!raw || typeof raw !== "object") return null;
	const obj = raw as Record<string, unknown>;
	const id = obj.id != null ? String(obj.id) : "";
	const command = typeof obj.command === "string" ? obj.command.trim() : "";
	if (!id || !command) return null;
	let params: Record<string, unknown> = {};
	if (obj.params !== undefined && obj.params !== null && typeof obj.params === "object") {
		params = obj.params as Record<string, unknown>;
	} else if (typeof obj.paramsJSON === "string") {
		try {
			params = JSON.parse(obj.paramsJSON) as Record<string, unknown>;
		} catch {
			// leave params empty
		}
	}
	const timeoutMs = typeof obj.timeoutMs === "number" && obj.timeoutMs > 0 ? obj.timeoutMs : null;
	return { id, nodeId: obj.nodeId as string | undefined, command, params, timeoutMs };
}

function sendResult(
	ws: WebSocket,
	invokeId: string,
	result: { ok: boolean; payload?: unknown; error?: { code: string; message: string } },
) {
	if (ws.readyState !== 1) return;
	try {
		const params: Record<string, unknown> = { id: invokeId, result };
		ws.send(JSON.stringify({ method: "node.invoke.result", params, id: `result-${invokeId}` }));
	} catch (e) {
		console.error("[browser-node] sendResult failed:", e instanceof Error ? e.message : e);
	}
}

const DEFAULT_VIEWPORT = { width: 1280, height: 1600 };

async function getOrCreatePage(): Promise<Page> {
	if (USER_DATA_DIR) {
		if (!persistentContext) {
			persistentContext = await webkit.launchPersistentContext(USER_DATA_DIR, { headless: !HEADED });
		}
		if (!currentPage) {
			currentPage = await persistentContext!.newPage();
			await currentPage.setViewportSize(DEFAULT_VIEWPORT);
		}
		return currentPage;
	}
	if (!persistentBrowser) {
		persistentBrowser = await webkit.launch({ headless: !HEADED });
	}
	if (!currentPage) {
		currentPage = await persistentBrowser!.newPage();
		await currentPage.setViewportSize(DEFAULT_VIEWPORT);
	}
	return currentPage;
}

async function handleBrowserFetch(params: Record<string, unknown>, timeoutMs: number) {
	const currentPageOnly = params?.currentPageOnly === true;
	const url = typeof params?.url === "string" ? params.url.trim() : "";
	if (!currentPageOnly && !url) {
		return {
			ok: false as const,
			error: {
				code: "INVALID_PARAMS",
				message: "browser_fetch requires params.url（或 currentPageOnly: true 仅截当前页）",
			},
		};
	}
	if (!currentPageOnly && !url.startsWith("http://") && !url.startsWith("https://")) {
		return { ok: false as const, error: { code: "INVALID_PARAMS", message: "url must be http or https" } };
	}
	const captureScreenshot = params?.captureScreenshot !== false;
	let waitAfterLoadMs =
		typeof params?.waitAfterLoadMs === "number" && params.waitAfterLoadMs >= 0
			? Math.min(params.waitAfterLoadMs, 300_000)
			: 0;
	if (waitAfterLoadMs === 0 && !currentPageOnly && url && /zhihu\.com|weibo\.com|login|signin/i.test(url)) {
		waitAfterLoadMs = 2000;
	}
	let waitUntil = (["domcontentloaded", "load", "networkidle"] as const).includes(
		params?.waitUntil as "domcontentloaded" | "load" | "networkidle",
	)
		? (params.waitUntil as "domcontentloaded" | "load" | "networkidle")
		: "domcontentloaded";
	if (
		waitUntil === "domcontentloaded" &&
		!currentPageOnly &&
		url &&
		/zhihu\.com\/people\/[^/]+\/(followers|following)/i.test(url)
	) {
		waitUntil = "networkidle";
		if (waitAfterLoadMs < 4000) waitAfterLoadMs = 4000;
	}

	let page: Page;
	try {
		page = await getOrCreatePage();
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		return { ok: false as const, error: { code: "BROWSER_ERROR", message } };
	}

	try {
		if (!currentPageOnly) {
			await page.goto(url, { waitUntil, timeout: timeoutMs });
			if (waitAfterLoadMs > 0) {
				await new Promise((r) => setTimeout(r, waitAfterLoadMs));
			}
		} else {
			if (waitAfterLoadMs > 0) {
				await new Promise((r) => setTimeout(r, waitAfterLoadMs));
			}
		}
		const text = (await page.evaluate("document.body ? document.body.innerText : ''")) as string;
		let screenshotBase64: string | undefined;
		if (captureScreenshot) {
			try {
				const buf = await page.screenshot({ type: "png" });
				const b64 = Buffer.from(buf).toString("base64");
				lastScreenshotBase64 = b64;
				lastScreenshotUrl = page.url();
				screenshotBase64 = b64;
			} catch {
				// ignore screenshot failure
			}
		}
		const out = text.length > MAX_FETCH_LENGTH ? text.slice(0, MAX_FETCH_LENGTH) + "\n\n[truncated]" : text;
		const payload: { content: string; screenshotBase64?: string; url?: string } = {
			content: out || "(no text content)",
			...(screenshotBase64 && { screenshotBase64, url: page.url() }),
		};
		return { ok: true as const, payload };
	} catch (e) {
		currentPage = null;
		const message = e instanceof Error ? e.message : String(e);
		return { ok: false as const, error: { code: "BROWSER_ERROR", message } };
	}
}

async function handleBrowserScreenshot(): Promise<{
	ok: boolean;
	payload?: { screenshotBase64: string; url?: string };
	error?: { code: string; message: string };
}> {
	if (lastScreenshotBase64) {
		return {
			ok: true,
			payload: {
				screenshotBase64: lastScreenshotBase64,
				...(lastScreenshotUrl && { url: lastScreenshotUrl }),
			},
		};
	}
	return {
		ok: false,
		error: {
			code: "NO_SCREENSHOT",
			message: "尚无截图，请先执行 browser_fetch（或带 captureScreenshot 的请求）",
		},
	};
}

const ws = new WebSocket(GATEWAY_URL);

ws.on("open", () => {
	const connectParams: Record<string, unknown> = {
		role: "node",
		deviceId: NODE_ID,
		capabilities: ["browser"],
	};
	if (TOKEN) connectParams.token = TOKEN;
	if (PASSWORD) connectParams.password = PASSWORD;
	if (VNC_PORT != null) connectParams.vncPort = VNC_PORT;
	ws.send(JSON.stringify({ method: "connect", params: connectParams, id: "connect-1" }));
});

ws.on("message", async (data: Buffer | ArrayBuffer) => {
	let msg: { event?: string; payload?: unknown; id?: string; ok?: boolean };
	try {
		msg = JSON.parse(toUtf8String(data)) as typeof msg;
	} catch {
		return;
	}
	if (msg.event !== "node.invoke.request") return;
	const payload = parsePayload(msg.payload);
	if (!payload || !payload.id) return;
	const invokeId = payload.id;
	const command = payload.command ?? "";
	const params = (payload.params ?? {}) as Record<string, unknown>;
	const timeoutMs =
		(typeof params.timeoutMs === "number" && params.timeoutMs > 0 ? params.timeoutMs : null) ??
		(typeof payload.timeoutMs === "number" && payload.timeoutMs > 0 ? payload.timeoutMs : null) ??
		DEFAULT_FETCH_TIMEOUT_MS;

	if (command === "browser_fetch") {
		if (fetchInProgress) {
			sendResult(ws, invokeId, {
				ok: false,
				error: { code: "BUSY", message: "节点正忙（上一请求未完成），请稍后再试" },
			});
			return;
		}
		fetchInProgress = true;
		try {
			const result = await handleBrowserFetch(params, timeoutMs);
			sendResult(ws, invokeId, result);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			sendResult(ws, invokeId, { ok: false, error: { code: "BROWSER_ERROR", message } });
		} finally {
			fetchInProgress = false;
		}
		return;
	}
	if (command === "browser_screenshot") {
		const result = await handleBrowserScreenshot();
		sendResult(ws, invokeId, result);
		return;
	}
	if (command === "browser_pages") {
		try {
			const pages: Array<{ index: number; url: string }> = [];
			if (persistentContext) {
				const list = persistentContext.pages();
				for (let i = 0; i < list.length; i++) {
					try {
						const u = list[i]!.url();
						pages.push({ index: i, url: u });
					} catch {
						pages.push({ index: i, url: "" });
					}
				}
			} else if (currentPage) {
				try {
					pages.push({ index: 0, url: currentPage.url() });
				} catch {
					pages.push({ index: 0, url: "" });
				}
			}
			sendResult(ws, invokeId, { ok: true, payload: { pages } });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			sendResult(ws, invokeId, { ok: false, error: { code: "BROWSER_ERROR", message } });
		}
		return;
	}
	if (command === "browser_switch") {
		const index = typeof params.index === "number" ? params.index : parseInt(String(params.index ?? ""), 10);
		if (!persistentContext || !Number.isInteger(index) || index < 0) {
			sendResult(ws, invokeId, {
				ok: false,
				error: {
					code: "INVALID_PARAMS",
					message: "browser_switch 需要 persistent context 且 params.index 为有效非负整数",
				},
			});
			return;
		}
		const list = persistentContext.pages();
		if (index >= list.length) {
			sendResult(ws, invokeId, {
				ok: false,
				error: { code: "INVALID_PARAMS", message: `index ${index} 超出范围 (0-${list.length - 1})` },
			});
			return;
		}
		currentPage = list[index]!;
		sendResult(ws, invokeId, { ok: true, payload: { index, url: currentPage.url() } });
		return;
	}
	if (command === "browser_new_tab") {
		if (!persistentContext) {
			sendResult(ws, invokeId, {
				ok: false,
				error: { code: "UNAVAILABLE", message: "browser_new_tab 需要设置 BROWSER_USER_DATA_DIR（持久化 context）" },
			});
			return;
		}
		try {
			const newPage = await persistentContext.newPage();
			const url = typeof params.url === "string" ? params.url.trim() : "";
			if (url && (url.startsWith("http://") || url.startsWith("https://"))) {
				await newPage.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
			}
			currentPage = newPage;
			sendResult(ws, invokeId, { ok: true, payload: { url: newPage.url() } });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			sendResult(ws, invokeId, { ok: false, error: { code: "BROWSER_ERROR", message } });
		}
		return;
	}
	if (command === "browser_links") {
		try {
			const page = await getOrCreatePage();
			const links = await page.evaluate(() => {
				return Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))
					.map((a) => ({ text: (a.innerText || a.textContent || "").trim().slice(0, 120), href: a.href }))
					.filter((x) => x.href && (x.href.startsWith("http://") || x.href.startsWith("https://")));
			});
			sendResult(ws, invokeId, { ok: true, payload: { links, currentUrl: page.url() } });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			sendResult(ws, invokeId, { ok: false, error: { code: "BROWSER_ERROR", message } });
		}
		return;
	}
	if (command === "browser_click") {
		try {
			const page = await getOrCreatePage();
			const selector = typeof params.selector === "string" ? params.selector.trim() : "";
			const text = typeof params.text === "string" ? params.text.trim() : "";
			const clickTimeout = 15_000;
			const waitAfterMs =
				typeof params.waitAfterMs === "number" && params.waitAfterMs >= 0
					? Math.min(params.waitAfterMs, 60_000)
					: 0;
			if (selector) {
				await page.click(selector, { timeout: clickTimeout });
			} else if (text) {
				const re = new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
				const linkLocator = page.locator("a[href]").filter({ hasText: re }).first();
				const linkCount = await linkLocator.count();
				if (linkCount > 0) {
					const href = await linkLocator.getAttribute("href");
					if (href && (href.startsWith("http://") || href.startsWith("https://") || href.startsWith("/"))) {
						const toOpen = href.startsWith("/") ? new URL(href, page.url()).href : href;
						await page.goto(toOpen, { waitUntil: "domcontentloaded", timeout: clickTimeout });
					} else {
						await linkLocator.evaluate((el) => el.scrollIntoView({ block: "center", inline: "nearest" }));
						await new Promise((r) => setTimeout(r, 300));
						await linkLocator.click({ timeout: clickTimeout, force: true });
					}
				} else {
					const clickable = page.locator('a, button, [role="button"], [onclick]').filter({ hasText: re }).first();
					await clickable.evaluate((el) => el.scrollIntoView({ block: "center", inline: "nearest" }));
					await new Promise((r) => setTimeout(r, 300));
					await clickable.click({ timeout: clickTimeout, force: true });
				}
				await new Promise((r) => setTimeout(r, 800));
			} else {
				sendResult(ws, invokeId, {
					ok: false,
					error: { code: "INVALID_PARAMS", message: "browser_click 需要 params.selector 或 params.text" },
				});
				return;
			}
			let screenshotBase64: string | undefined;
			if (waitAfterMs > 0) {
				await new Promise((r) => setTimeout(r, waitAfterMs));
				try {
					const buf = await page.screenshot({ type: "png" });
					screenshotBase64 = Buffer.from(buf).toString("base64");
					lastScreenshotBase64 = screenshotBase64;
					lastScreenshotUrl = page.url();
				} catch {
					// ignore
				}
			}
			const payload: { url: string; screenshotBase64?: string } = { url: page.url() };
			if (screenshotBase64) payload.screenshotBase64 = screenshotBase64;
			sendResult(ws, invokeId, { ok: true, payload });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			sendResult(ws, invokeId, { ok: false, error: { code: "BROWSER_ERROR", message } });
		}
		return;
	}
	if (command === "browser_fill") {
		try {
			const page = await getOrCreatePage();
			if (typeof params.text !== "string") {
				sendResult(ws, invokeId, {
					ok: false,
					error: {
						code: "INVALID_PARAMS",
						message: "browser_fill 需要 params.text（要填入的内容，可为空字符串清空）",
					},
				});
				return;
			}
			const text = params.text;
			const selector = typeof params.selector === "string" ? params.selector.trim() : "";
			const placeholder = typeof params.placeholder === "string" ? params.placeholder.trim() : "";
			if (selector) {
				await page.fill(selector, text, { timeout: 10_000 });
			} else if (placeholder) {
				await page.getByPlaceholder(placeholder).first().fill(text, { timeout: 10_000 });
			} else {
				sendResult(ws, invokeId, {
					ok: false,
					error: {
						code: "INVALID_PARAMS",
						message: "browser_fill 需要 params.selector 或 params.placeholder 指定目标输入框",
					},
				});
				return;
			}
			await new Promise((r) => setTimeout(r, 300));
			sendResult(ws, invokeId, { ok: true, payload: { url: page.url() } });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			sendResult(ws, invokeId, { ok: false, error: { code: "BROWSER_ERROR", message } });
		}
		return;
	}

	sendResult(ws, invokeId, {
		ok: false,
		error: { code: "UNAVAILABLE", message: `command not supported: ${command}` },
	});
});

ws.on("close", () => {
	console.error("与 Gateway 断开");
	process.exit(0);
});
ws.on("error", (err) => {
	console.error("WebSocket 错误:", err.message);
	process.exit(1);
});

const onFirstMessage = (data: Buffer | ArrayBuffer) => {
	let msg: { id?: string; ok?: boolean; error?: { message?: string } };
	try {
		msg = JSON.parse(toUtf8String(data)) as typeof msg;
	} catch {
		return;
	}
	if (msg.id === "connect-1") {
		ws.off("message", onFirstMessage);
		if (msg.ok !== true) {
			console.error("Connect failed:", msg.error?.message ?? "unknown");
			process.exit(1);
		}
		console.log(`Browser Node 已连接: nodeId=${NODE_ID}, headed=${HEADED}, userDataDir=${USER_DATA_DIR ?? "none"}`);
	}
};
ws.once("message", onFirstMessage);

console.log(`Browser Node: nodeId=${NODE_ID}, gateway=${GATEWAY_URL}, headed=${HEADED}`);
