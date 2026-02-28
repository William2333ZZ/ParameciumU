#!/usr/bin/env node
/**
 * 以「Agent」身份连到 Gateway，用指定 agent 目录执行派发过来的对话，并回传 node.invoke.result；
 * 同时在本进程跑 cron runScheduler，到点执行 agentTurn 任务，可选将结果经 connector.message.push 推到 App。
 *
 * 用法（在 monorepo 根或任意目录）:
 *   GATEWAY_WS_URL=ws://127.0.0.1:9347 AGENT_ID=A_agent AGENT_DIR=./A_agent node apps/gateway/dist/agent-client.js
 *
 * 环境变量:
 *   GATEWAY_URL   Gateway WebSocket 地址（必填）
 *   AGENT_ID      注册的 agentId（必填）
 *   AGENT_DIR     该 agent 的目录，与 .u 同构（其下 cron/、skills/ 等；会话由 Gateway 管理），默认 process.cwd()/.u
 *   DEVICE_ID     可选，默认本机 hostname
 *   GATEWAY_TOKEN / GATEWAY_PASSWORD  可选，与 Gateway 认证一致
 */

import "dotenv/config";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import type { CronJob } from "@monou/cron";
import { runScheduler } from "@monou/cron/scheduler";
import WebSocket from "ws";
import { runAgentTurn } from "./agent-runner.js";

/** Gateway WebSocket 地址；优先 GATEWAY_WS_URL（与 .env 一致），否则 GATEWAY_URL，未设则默认 9347 */
const GATEWAY_URL = process.env.GATEWAY_WS_URL?.trim() || process.env.GATEWAY_URL?.trim() || "ws://127.0.0.1:9347";
/** 未设时默认为 .u（本机默认 agent，对应 .u 目录） */
const AGENT_ID = process.env.AGENT_ID?.trim() || ".u";
const AGENT_DIR = process.env.AGENT_DIR?.trim() || process.env.AGENT_ROOT_DIR?.trim();
/** 未设时用 hostname，使同机多 Agent 在节点图中聚为一台「设备」；设 DEVICE_ID=AGENT_ID 可恢复一 Agent 一节点 */
const DEVICE_ID = process.env.DEVICE_ID?.trim() || os.hostname() || AGENT_ID;
const TOKEN = process.env.GATEWAY_TOKEN?.trim();
const PASSWORD = process.env.GATEWAY_PASSWORD?.trim();

/** 与 .u 同构的 agent 目录（其下 cron/、skills/ 等）；未设则用 cwd/.u */
const agentDir = AGENT_DIR != null ? path.resolve(AGENT_DIR) : path.join(process.cwd(), ".u");
const cronStorePath = path.join(agentDir, "cron", "jobs.json");

/** 同一目录下只允许一个 agent 进程：用 pid 文件加锁，退出时释放 */
const LOCK_FILE = path.join(agentDir, ".agent-client.pid");
function isPidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}
function tryLock(): boolean {
	const pid = process.pid;
	if (fs.existsSync(LOCK_FILE)) {
		try {
			const prev = Number(fs.readFileSync(LOCK_FILE, "utf8").trim());
			if (prev && prev !== pid && isPidAlive(prev)) {
				return false;
			}
		} catch {
			/* 读失败则覆盖 */
		}
	}
	try {
		fs.writeFileSync(LOCK_FILE, String(pid), "utf8");
		return true;
	} catch {
		return false;
	}
}
function unlock(): void {
	try {
		if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE);
	} catch {
		/* 忽略 */
	}
}

if (!tryLock()) {
	const prev = fs.existsSync(LOCK_FILE) ? Number(fs.readFileSync(LOCK_FILE, "utf8").trim()) : 0;
	console.error(`该 agent 目录已有进程在跑 (PID ${prev})，同一目录下只允许一个 agent。请先结束该进程或换用其他目录。`);
	process.exit(1);
}
process.on("exit", unlock);
process.on("SIGINT", () => {
	unlock();
	process.exit(0);
});
process.on("SIGTERM", () => {
	unlock();
	process.exit(0);
});

const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function request(ws: WebSocket, method: string, params?: Record<string, unknown>): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const id = `req-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
		if (ws.readyState !== 1) {
			reject(new Error("Gateway not connected"));
			return;
		}
		pending.set(id, { resolve, reject });
		ws.send(JSON.stringify({ method, params, id }));
		setTimeout(() => {
			if (pending.delete(id)) reject(new Error("Gateway request timeout"));
		}, 120_000);
	});
}

const ws = new WebSocket(GATEWAY_URL);

/** 是否已成功完成 connect（用于断开时提示） */
let connectDone = false;
/** 是否已启动 cron，避免重复调用 */
let cronStarted = false;
function onConnectSuccess(): void {
	connectDone = true;
	if (!cronStarted) {
		cronStarted = true;
		console.log("已连接并注册，等待派发…");
		startCronScheduler();
	}
}

ws.on("open", () => {
	const params: Record<string, unknown> = {
		role: "agent",
		agentId: AGENT_ID,
		deviceId: DEVICE_ID,
	};
	if (TOKEN) params.token = TOKEN;
	if (PASSWORD) params.password = PASSWORD;
	ws.send(JSON.stringify({ method: "connect", params, id: "connect-1" }));
});

ws.on("message", async (data: Buffer | ArrayBuffer) => {
	let msg: {
		id?: string;
		ok?: boolean;
		payload?: unknown;
		error?: { message?: string };
		event?: string;
	};
	try {
		const raw = typeof data === "string" ? data : (data as Buffer).toString("utf8");
		msg = JSON.parse(raw) as typeof msg;
	} catch {
		return;
	}
	const id = msg.id;
	// 任意一条消息都可能是 connect 响应（兼容服务端先发其他包的情况）
	if (id === "connect-1") {
		if (msg.ok === true) {
			onConnectSuccess();
			return;
		}
		console.error("Connect failed:", msg.error?.message ?? "unknown");
		process.exit(1);
	}
	if (id !== undefined && pending.has(id)) {
		const { resolve: res, reject: rej } = pending.get(id)!;
		pending.delete(id);
		if (msg.ok === false) {
			rej(new Error(msg.error?.message ?? "Gateway error"));
		} else {
			res(msg.payload);
		}
		return;
	}
	const event = msg.event;
	const payload = msg.payload as { id?: string; __agent?: boolean; message?: string } | undefined;
	if (event === "node.invoke.request" && payload?.__agent === true && typeof payload.message === "string") {
		const invokeId = payload.id;
		const prevMemory = process.env.MEMORY_WORKSPACE;
		const prevCron = process.env.CRON_STORE;
		const prevKnowledge = process.env.KNOWLEDGE_WORKSPACE;
		process.env.MEMORY_WORKSPACE = agentDir;
		process.env.CRON_STORE = cronStorePath;
		process.env.KNOWLEDGE_WORKSPACE = agentDir;
		try {
			const result = await runAgentTurn(process.cwd(), payload.message, { agentDir });
			ws.send(
				JSON.stringify({
					method: "node.invoke.result",
					params: { id: invokeId, result },
					id: `result-${invokeId}`,
				}),
			);
		} catch (err) {
			ws.send(
				JSON.stringify({
					method: "node.invoke.result",
					params: { id: invokeId, result: { text: `[error] ${(err as Error).message}`, toolCalls: [] } },
					id: `result-${invokeId}`,
				}),
			);
		} finally {
			if (prevMemory !== undefined) process.env.MEMORY_WORKSPACE = prevMemory;
			else delete process.env.MEMORY_WORKSPACE;
			if (prevCron !== undefined) process.env.CRON_STORE = prevCron;
			else delete process.env.CRON_STORE;
			if (prevKnowledge !== undefined) process.env.KNOWLEDGE_WORKSPACE = prevKnowledge;
			else delete process.env.KNOWLEDGE_WORKSPACE;
		}
	}
});

ws.on("close", () => {
	console.error("与 Gateway 断开");
	if (!connectDone) {
		console.error(
			"提示: 若 Gateway 启用了认证，请在 .env 中设置 GATEWAY_TOKEN 或 GATEWAY_PASSWORD 与 Gateway 一致；并确认 .env 中 GATEWAY_WS_URL 指向本项目 Gateway（npm run gateway）。",
		);
	}
	unlock();
	process.exit(0);
});
ws.on("error", (err) => {
	console.error("WebSocket 错误:", err.message);
	unlock();
	process.exit(1);
});

const onFirstMessage = (data: Buffer | ArrayBuffer) => {
	let msg: { id?: string; ok?: boolean; error?: { message?: string } };
	try {
		const raw = typeof data === "string" ? data : (data as Buffer).toString("utf8");
		msg = JSON.parse(raw) as typeof msg;
	} catch {
		return;
	}
	if (msg.id === "connect-1") {
		ws.off("message", onFirstMessage);
		if (msg.ok !== true) {
			console.error("Connect failed:", msg.error?.message ?? "unknown");
			process.exit(1);
		}
		onConnectSuccess();
	} else {
		const raw = typeof data === "string" ? data : (data as Buffer).toString("utf8");
		console.error("首条消息不是 connect 响应，请确认 GATEWAY_WS_URL 指向本项目 Gateway。收到:", raw.slice(0, 200));
	}
};
ws.once("message", onFirstMessage);

function startCronScheduler(): void {
	runScheduler(cronStorePath, {
		log: {
			info: (m: string, d?: Record<string, unknown>) => console.log(`[cron] ${m}`, d ?? ""),
			warn: (m: string, d?: Record<string, unknown>) => console.warn(`[cron] ${m}`, d ?? ""),
		},
		onJobDue: async (job: CronJob) => {
			if (job.payload.kind !== "agentTurn") return;
			console.log(`[cron] onJobDue start job=${job.name} (id=${job.id})`);
			const prevMemory = process.env.MEMORY_WORKSPACE;
			const prevCron = process.env.CRON_STORE;
			const prevKnowledge = process.env.KNOWLEDGE_WORKSPACE;
			process.env.MEMORY_WORKSPACE = agentDir;
			process.env.CRON_STORE = cronStorePath;
			process.env.KNOWLEDGE_WORKSPACE = agentDir;
			try {
				const result = await runAgentTurn(process.cwd(), job.payload.message, { agentDir });
				const text = result?.text ?? "";
				console.log(`[cron] onJobDue done job=${job.name} textLen=${text.length}`);
				if (job.deliver?.connectorId && job.deliver?.chatId && text) {
					await request(ws, "connector.message.push", {
						connectorId: job.deliver.connectorId,
						chatId: job.deliver.chatId,
						text,
					});
					console.log(`[cron] pushed to ${job.deliver.connectorId}/${job.deliver.chatId}`);
				}
			} catch (err) {
				const e = err as Error;
				console.warn(`[cron] onJobDue failed job=${job.id}:`, e.message);
				if (e.message === "Connection error." || e.message?.includes("Connection error"))
					console.warn("[cron] 提示: 多为 LLM API 网络不通（如 BIANXIE_BASE_URL 不可达），请检查网络或代理。");
				if (/^\d{3}\b|Extra data/i.test(e.message))
					console.warn(
						"[cron] 提示: 400/Extra data 多为 LLM 代理或服务端 JSON 解析失败，请检查 BIANXIE_BASE_URL、代理配置。",
					);
				if (job.name === "Heartbeat") {
					try {
						await request(ws, "agent.heartbeat", {});
					} catch {
						// 忽略上报失败
					}
				}
			} finally {
				if (prevMemory !== undefined) process.env.MEMORY_WORKSPACE = prevMemory;
				else delete process.env.MEMORY_WORKSPACE;
				if (prevCron !== undefined) process.env.CRON_STORE = prevCron;
				else delete process.env.CRON_STORE;
				if (prevKnowledge !== undefined) process.env.KNOWLEDGE_WORKSPACE = prevKnowledge;
				else delete process.env.KNOWLEDGE_WORKSPACE;
			}
		},
	}).catch((err) => {
		console.error("[cron] scheduler fatal:", (err as Error).message);
	});
}

console.log(`Agent 客户端: agentId=${AGENT_ID}, agentDir=${agentDir}, gateway=${GATEWAY_URL}`);
