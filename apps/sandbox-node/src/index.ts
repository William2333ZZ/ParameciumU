#!/usr/bin/env node
/**
 * Sandbox Node（方案 B）：以 role=node 连接 Gateway，声明 capabilities: ["sandbox"]，
 * 在隔离 workspace 内执行 system.run / system.which；可被 node.invoke 定向调用。
 *
 * 用法:
 *   GATEWAY_URL=ws://127.0.0.1:18789 SANDBOX_NODE_ID=sandbox-1 SANDBOX_WORKSPACE=./.sandbox node dist/index.js
 *
 * 环境变量:
 *   GATEWAY_URL       Gateway WebSocket 地址（必填）
 *   SANDBOX_NODE_ID   本节点 ID，用于 node.list / node.invoke 目标（默认 sandbox-1）
 *   SANDBOX_WORKSPACE 沙箱工作目录，命令在此目录下执行（默认 os.tmpdir()/monou-sandbox-<nodeId>）
 *   SANDBOX_USE_DOCKER 默认 1（Docker 容器执行，与 OpenClaw 一致）；设为 0 时退化为本机目录+子进程
 *   SANDBOX_IMAGE      Docker 模式下的镜像（默认 debian:bookworm-slim）
 *   GATEWAY_TOKEN / GATEWAY_PASSWORD  可选认证
 */

import "dotenv/config";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import WebSocket from "ws";
import {
  ensureSandboxContainer,
  getSandboxContainerName,
  runInContainer,
  DEFAULT_WORKDIR,
} from "./docker.js";

/** 支持 GATEWAY_WS_URL（与 .env 一致） */
const GATEWAY_URL = process.env.GATEWAY_WS_URL?.trim() || process.env.GATEWAY_URL?.trim();
const NODE_ID = process.env.SANDBOX_NODE_ID?.trim() || "sandbox-1";
const WORKSPACE_ENV = process.env.SANDBOX_WORKSPACE?.trim();
/** 默认用 Docker；仅当明确设为 0 时用本机子进程（无容器隔离） */
const USE_DOCKER = process.env.SANDBOX_USE_DOCKER?.trim() !== "0";
const SANDBOX_IMAGE = process.env.SANDBOX_IMAGE?.trim() || "debian:bookworm-slim";
const TOKEN = process.env.GATEWAY_TOKEN?.trim();
const PASSWORD = process.env.GATEWAY_PASSWORD?.trim();

if (!GATEWAY_URL) {
  console.error("需要设置 GATEWAY_URL 或 GATEWAY_WS_URL（可在 .env）");
  console.error("示例: GATEWAY_WS_URL=ws://127.0.0.1:9347 SANDBOX_NODE_ID=sandbox-1 npm run sandbox-node");
  process.exit(1);
}

const workspaceDir =
  WORKSPACE_ENV != null ? path.resolve(WORKSPACE_ENV) : path.join(os.tmpdir(), `monou-sandbox-${NODE_ID}`);

const sandboxContainerName = USE_DOCKER ? getSandboxContainerName(NODE_ID) : null;
let containerReady = false;

async function ensureContainer(): Promise<void> {
  if (!USE_DOCKER || !sandboxContainerName) return;
  if (containerReady) return;
  await fs.mkdir(workspaceDir, { recursive: true });
  await ensureSandboxContainer({
    containerName: sandboxContainerName,
    workspaceDir,
    image: SANDBOX_IMAGE,
    workdir: DEFAULT_WORKDIR,
  });
  containerReady = true;
}

function escapeShSingleQuotes(s: string): string {
  return s.replace(/'/g, "'\"'\"'");
}

function argvToShCommand(argv: string[]): string {
  return argv.map((a) => `'${escapeShSingleQuotes(a)}'`).join(" ");
}

type NodeInvokePayload = {
  id?: string;
  nodeId?: string;
  command?: string;
  paramsJSON?: string | null;
  params?: Record<string, unknown>;
  timeoutMs?: number | null;
};

function toUtf8String(data: Buffer | ArrayBuffer): string {
  if (typeof data === "string") return data;
  if (data instanceof Buffer) return data.toString("utf8");
  return Buffer.from(new Uint8Array(data)).toString("utf8");
}

function parsePayload(raw: unknown): NodeInvokePayload | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const id = obj.id != null ? String(obj.id) : "";
  const nodeId = obj.nodeId != null ? String(obj.nodeId) : "";
  const command = typeof obj.command === "string" ? obj.command.trim() : "";
  if (!id || !command) return null;
  let paramsJSON: string | null = null;
  if (typeof obj.paramsJSON === "string") paramsJSON = obj.paramsJSON;
  else if (obj.params !== undefined) paramsJSON = JSON.stringify(obj.params);
  const timeoutMs =
    typeof obj.timeoutMs === "number" && obj.timeoutMs > 0 ? obj.timeoutMs : null;
  return { id, nodeId, command, paramsJSON, timeoutMs };
}

function decodeParams<T = Record<string, unknown>>(paramsJSON: string | null | undefined): T {
  const s = paramsJSON ?? "";
  if (s === "") return {} as T;
  try {
    return JSON.parse(s) as T;
  } catch {
    return {} as T;
  }
}

async function runInProcess(
  argv: string[],
  opts: { cwd: string; timeoutMs?: number | null },
): Promise<{ ok: boolean; exitCode?: number; stdout?: string; stderr?: string; error?: string }> {
  if (argv.length === 0) {
    return { ok: false, error: "command required" };
  }
  return new Promise((resolve) => {
    const timeoutMs = opts.timeoutMs ?? 60_000;
    const child = spawn(argv[0], argv.slice(1), {
      cwd: opts.cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (c: Buffer) => {
      stdout += c.toString();
    });
    child.stderr?.on("data", (c: Buffer) => {
      stderr += c.toString();
    });
    let settled = false;
    const done = (result: { ok: boolean; exitCode?: number; stdout?: string; stderr?: string; error?: string }) => {
      if (settled) return;
      settled = true;
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      resolve(result);
    };
    const t = setTimeout(() => {
      done({ ok: false, error: "timeout", stdout, stderr });
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(t);
      done({ ok: false, error: err.message, stdout, stderr });
    });
    child.on("exit", (code, signal) => {
      clearTimeout(t);
      const exitCode = code ?? (signal ? 128 : 0);
      done({
        ok: exitCode === 0,
        exitCode,
        stdout: stdout || undefined,
        stderr: stderr || undefined,
      });
    });
  });
}

async function runInSandbox(
  argv: string[],
  opts: { cwd: string; timeoutMs?: number | null },
): Promise<{ ok: boolean; exitCode?: number; stdout?: string; stderr?: string; error?: string }> {
  if (argv.length === 0) {
    return { ok: false, error: "command required" };
  }
  if (USE_DOCKER && sandboxContainerName) {
    await ensureContainer();
    const command = argvToShCommand(argv);
    const timeoutMs = opts.timeoutMs ?? 60_000;
    const r = await runInContainer({
      containerName: sandboxContainerName,
      workdir: DEFAULT_WORKDIR,
      command,
      timeoutMs,
    });
    return {
      ok: r.ok,
      exitCode: r.exitCode,
      stdout: r.stdout || undefined,
      stderr: r.stderr || undefined,
      error: r.error,
    };
  }
  return runInProcess(argv, opts);
}

async function handleSystemRun(paramsJSON: string | null, cwd: string, timeoutMs: number | null) {
  const params = decodeParams<{ command?: unknown[]; rawCommand?: string }>(paramsJSON);
  const command = Array.isArray(params.command) ? params.command.map(String) : [];
  if (command.length === 0) {
    const raw = typeof params.rawCommand === "string" ? params.rawCommand.trim() : "";
    if (raw) {
      const parts = /^(\S+)(.*)$/.exec(raw);
      if (parts) {
        const first = parts[1];
        const rest = parts[2].trim() ? parts[2].trim().split(/\s+/) : [];
        command.push(first, ...rest);
      }
    }
  }
  if (command.length === 0) {
    return { ok: false, error: { code: "INVALID_REQUEST", message: "command required" } };
  }
  const result = await runInSandbox(command, { cwd, timeoutMs });
  if (result.error && !result.ok) {
    return {
      ok: false,
      error: { code: "EXEC_FAILED", message: result.error },
      payload: { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr },
    };
  }
  return {
    ok: true,
    payload: {
      exitCode: result.exitCode ?? 0,
      stdout: result.stdout,
      stderr: result.stderr,
    },
  };
}

async function handleSystemWhich(paramsJSON: string | null, cwd: string) {
  const params = decodeParams<{ bins?: unknown[] }>(paramsJSON);
  const bins = Array.isArray(params.bins) ? params.bins.map(String) : [];
  if (bins.length === 0) {
    return { ok: false, error: { code: "INVALID_REQUEST", message: "bins required" } };
  }
  const out: Record<string, string | null> = {};
  for (const bin of bins) {
    const r = await runInSandbox(["which", bin], { cwd, timeoutMs: 5000 });
    const line = (r.stdout ?? "").trim().split("\n")[0]?.trim() || null;
    out[bin] = line && r.ok ? line : null;
  }
  return { ok: true, payload: { bins: out } };
}

function sendResult(
  ws: WebSocket,
  invokeId: string,
  result: { ok: boolean; payload?: unknown; payloadJSON?: string; error?: { code: string; message: string } },
) {
  const params: Record<string, unknown> = { id: invokeId };
  if (result.ok) {
    const payloadJSON =
      result.payloadJSON ?? (result.payload != null ? JSON.stringify(result.payload) : undefined);
    params.result = payloadJSON != null ? { ok: true, payloadJSON } : { ok: true };
  } else {
    params.result = { ok: false, error: result.error ?? { code: "UNKNOWN", message: "sandbox error" } };
  }
  ws.send(JSON.stringify({ method: "node.invoke.result", params, id: `result-${invokeId}` }));
}

const ws = new WebSocket(GATEWAY_URL);

ws.on("open", () => {
  const connectParams: Record<string, unknown> = {
    role: "node",
    deviceId: NODE_ID,
    capabilities: ["sandbox"],
  };
  if (TOKEN) connectParams.token = TOKEN;
  if (PASSWORD) connectParams.password = PASSWORD;
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
  try {
    await fs.mkdir(workspaceDir, { recursive: true });
  } catch (e) {
    sendResult(ws, invokeId, {
      ok: false,
      error: { code: "SANDBOX_ERROR", message: (e as Error).message },
    });
    return;
  }
  if (command === "system.run") {
    const result = await handleSystemRun(payload.paramsJSON ?? null, workspaceDir, payload.timeoutMs ?? null);
    sendResult(ws, invokeId, {
      ok: result.ok,
      payload: result.payload,
      payloadJSON: result.payload ? JSON.stringify(result.payload) : undefined,
      error: result.error,
    });
    return;
  }
  if (command === "system.which") {
    const result = await handleSystemWhich(payload.paramsJSON ?? null, workspaceDir);
    sendResult(ws, invokeId, {
      ok: result.ok,
      payload: result.payload,
      payloadJSON: result.payload ? JSON.stringify(result.payload) : undefined,
      error: result.error,
    });
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

const onFirstMessage = async (data: Buffer | ArrayBuffer) => {
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
    console.log(`Sandbox Node 已连接: nodeId=${NODE_ID}, workspace=${workspaceDir}`);
  }
};
ws.once("message", onFirstMessage);

console.log(`Sandbox Node: nodeId=${NODE_ID}, gateway=${GATEWAY_URL}, workspace=${workspaceDir}`);
