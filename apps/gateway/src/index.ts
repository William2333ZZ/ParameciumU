#!/usr/bin/env node
/**
 * ParameciumU Gateway — WebSocket server：health、cron.*、connect、agents、sessions、agent、node.*
 *
 * Usage: npx monou-gateway or npm run gateway
 * 环境变量:
 *   GATEWAY_PORT=9347
 *   GATEWAY_DATA_DIR= 或 GATEWAY_STATE_DIR= 覆盖数据目录（默认 ./.gateway）
 *   CRON_STORE=
 *   GATEWAY_AGENT_HEARTBEAT_TIMEOUT_MS= 超时未收到 agent.heartbeat 则断开该连接（0 表示不断开）
 *   GATEWAY_TOKEN= 或 GATEWAY_PASSWORD= 启用认证（connect 时必带 token 或 password）
 *   GATEWAY_TLS_CERT= 与 GATEWAY_TLS_KEY= 启用 wss
 *
 * Agent 执行由已连接的 agent 进程（如 npm run agent）完成；Gateway 仅转发请求，不内嵌 runTurn。
 */

import "dotenv/config";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { CronStore, getDefaultStorePath } from "@monou/cron";
import { resolveAuthConfig } from "./auth.js";
import { createGatewayContext, DEFAULT_LOCAL_AGENT_ID } from "./context.js";
import { createHandlers } from "./handlers.js";
import { discoverHooks, emitHook } from "./hooks.js";
import { loadConnectorMappingsSync, saveConnectorMappings } from "./mappings-store.js";
import { ensureGatewayDataDir, MAPPINGS_FILE, resolveGatewayDataDir } from "./paths.js";
import { createSessionQueueState } from "./queue.js";
import { getLatestPendingScreenshotPath, resolveScreenshotPath } from "./screenshots.js";
import { broadcastEvent, createGatewayWsServer, pushToConnector, startHeartbeatTimeoutCheck } from "./server.js";
import {
	clearSessionStoreAndTranscripts,
	ensureSessionStoreReady,
	getDefaultTranscriptPath,
	resolveSessionStorePath,
} from "./session-store.js";
import { createHttpsServer, resolveTlsConfig } from "./tls.js";

const PORT =
	Number(process.env.GATEWAY_PORT ?? process.argv.find((a) => a.startsWith("--port="))?.split("=")[1]) || 9347;
const HOST = process.env.GATEWAY_HOST ?? "127.0.0.1";
/** 本机默认 agent 的工作区根目录，其下 .u 为配置与对话（与 DEFAULT_LOCAL_AGENT_ID 对应）；启动 Gateway 时的 cwd */
const ROOT_DIR = process.cwd();
/** Gateway 数据目录（与 OpenClaw 的 ~/.openclaw 对应，但为项目内 ./.gateway）：映射等持久化 */
const GATEWAY_DATA_DIR = resolveGatewayDataDir(ROOT_DIR);
ensureGatewayDataDir(GATEWAY_DATA_DIR);

const storePath = getDefaultStorePath(ROOT_DIR);
const initialMappings = loadConnectorMappingsSync(GATEWAY_DATA_DIR, MAPPINGS_FILE);

const sessionStorePath = resolveSessionStorePath(GATEWAY_DATA_DIR);
/** 仅确保 store 文件存在；未指定 sessionKey 时由 resolveSession 按时间生成新 key */
const defaultTranscriptPath = getDefaultTranscriptPath(sessionStorePath);
clearSessionStoreAndTranscripts(sessionStorePath);
ensureSessionStoreReady(sessionStorePath);

const ctx = createGatewayContext({
	cronStore: new CronStore(storePath),
	rootDir: ROOT_DIR,
	sessionStorePath,
	mainTranscriptPath: defaultTranscriptPath,
	initialConnectorMappings: initialMappings,
});
ctx.persistConnectorMappings = async () => {
	await saveConnectorMappings(GATEWAY_DATA_DIR, MAPPINGS_FILE, ctx.connectorMappings);
};
ctx.sessionQueue = createSessionQueueState();
const heartbeatTimeoutMs = Number(process.env.GATEWAY_AGENT_HEARTBEAT_TIMEOUT_MS) || 0;
if (heartbeatTimeoutMs > 0) ctx.heartbeatTimeoutMs = heartbeatTimeoutMs;

const hooks = discoverHooks({
	workspaceHooksDir: path.join(ROOT_DIR, ".u", "hooks"),
	managedHooksDir: path.join(GATEWAY_DATA_DIR, "hooks"),
	bundledHooksDir: path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "hooks"),
});

const handlers = createHandlers({ ...ctx });

const auth = resolveAuthConfig();
const tlsConfig = resolveTlsConfig();

/** 处理 HTTP(S) 请求：GET /api/screenshots/:sessionKey/:id 返回截图文件，其余 404 */
function createScreenshotRequestHandler(
	screenshotsDir: string,
): (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void {
	const prefix = "/api/screenshots/";
	return (req, res) => {
		const pathname = req.url?.split("?")[0] ?? "";
		if (req.method === "GET" && pathname.startsWith(prefix)) {
			const rest = pathname.slice(prefix.length);
			const idx = rest.indexOf("/");
			if (idx === -1) {
				res.statusCode = 404;
				res.end();
				return;
			}
			const sessionKey = decodeURIComponent(rest.slice(0, idx));
			const id = rest.slice(idx + 1);
			let filePath: string | null;
			if (sessionKey === "pending" && id === "latest") {
				filePath = getLatestPendingScreenshotPath(screenshotsDir);
			} else {
				filePath = resolveScreenshotPath(screenshotsDir, sessionKey, id);
			}
			if (!filePath) {
				res.statusCode = 404;
				res.end();
				return;
			}
			const ext = path.extname(filePath).toLowerCase();
			res.setHeader("Content-Type", ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png");
			fs.createReadStream(filePath).pipe(res);
			return;
		}
		res.statusCode = 404;
		res.end();
	};
}

function logListen(port: number, host: string): void {
	const scheme = tlsConfig ? "wss" : "ws";
	const hostname = os.hostname();
	console.log(`ParameciumU Gateway ${scheme}://${host}:${port} (hostname: ${hostname})`);
	console.log(`  data dir: ${GATEWAY_DATA_DIR}`);
	console.log(`  cron store: ${storePath}`);
	if (auth && (auth.token != null || auth.password != null))
		console.log("  auth: token/password required (send connect first)");
	if (tlsConfig) console.log("  TLS: enabled");
	console.log("  agent: forward only (run 'npm run agent' to connect an agent)");
	if (ctx.heartbeatTimeoutMs && ctx.heartbeatTimeoutMs > 0)
		console.log(`  agent heartbeat timeout: ${ctx.heartbeatTimeoutMs}ms (no heartbeat → disconnect)`);
	console.log(
		"  methods: connect, health, status, cron.*, agents.list, sessions.*, agent, agent.wait, chat.history, chat.send, chat.abort, skills.status, node.*, connector.mapping.*, connector.message.inbound, connector.message.push",
	);
}

let wss: import("ws").WebSocketServer;
let httpOrHttpsServer: import("node:http").Server | import("node:https").Server | undefined;

if (tlsConfig) {
	httpOrHttpsServer = createHttpsServer(tlsConfig, createScreenshotRequestHandler(ctx.screenshotsDir));
	wss = createGatewayWsServer({
		context: ctx,
		handlers,
		auth,
		server: httpOrHttpsServer,
	});
	ctx.broadcast = (event: string, payload: unknown) => broadcastEvent(wss, { event, payload });
	ctx.pushToConnector = (connectorId, event, payload) => pushToConnector(ctx, connectorId, event, payload);
	startHeartbeatTimeoutCheck(ctx);
	httpOrHttpsServer.listen(PORT, HOST, async () => {
		logListen(PORT, HOST);
		await emitHook(
			{ type: "gateway", action: "startup", context: { rootDir: ROOT_DIR, gatewayDataDir: GATEWAY_DATA_DIR } },
			hooks,
			{ rootDir: ROOT_DIR, gatewayDataDir: GATEWAY_DATA_DIR },
		);
	});
} else {
	httpOrHttpsServer = http.createServer(createScreenshotRequestHandler(ctx.screenshotsDir));
	wss = createGatewayWsServer({
		context: ctx,
		handlers,
		auth,
		server: httpOrHttpsServer,
	});
	ctx.broadcast = (event: string, payload: unknown) => broadcastEvent(wss, { event, payload });
	ctx.pushToConnector = (connectorId, event, payload) => pushToConnector(ctx, connectorId, event, payload);
	startHeartbeatTimeoutCheck(ctx);
	httpOrHttpsServer.listen(PORT, HOST, async () => {
		logListen(PORT, HOST);
		await emitHook(
			{ type: "gateway", action: "startup", context: { rootDir: ROOT_DIR, gatewayDataDir: GATEWAY_DATA_DIR } },
			hooks,
			{ rootDir: ROOT_DIR, gatewayDataDir: GATEWAY_DATA_DIR },
		);
	});
}

let shuttingDown = false;
function shutdown(signal: string): void {
	if (shuttingDown) return;
	shuttingDown = true;
	console.log(`\n${signal}, closing server...`);
	if (httpOrHttpsServer) {
		httpOrHttpsServer.close(() => process.exit(0));
	} else {
		wss.close(() => process.exit(0));
	}
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
