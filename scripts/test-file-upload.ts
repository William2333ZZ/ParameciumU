#!/usr/bin/env npx tsx
/**
 * 测试 file.upload：上传到对应 Agent 的 ~/.uagent_tmp（非 Gateway）。
 * 流程：启动 Gateway + Agent → connect → file.upload → 检查返回 path 含 .uagent_tmp。
 *
 * 运行：npm run build && npx tsx scripts/test-file-upload.ts
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { callGateway } from "@monou/gateway";

const ROOT = path.resolve(new URL(import.meta.url).pathname, "../..");
const port = Number(process.env.GATEWAY_PORT) || 29347;
const gwUrl = `ws://127.0.0.1:${port}`;

function ok(msg: string) {
  console.log("[OK] " + msg);
}
function fail(label: string, detail: string) {
  console.error("[FAIL] " + label + ": " + detail);
  process.exit(1);
}

async function main() {
  console.log("=== 测试 file.upload（上传到 Agent 侧 ~/.uagent_tmp）===\n");

  const gatewayPath = path.join(ROOT, "apps", "gateway", "dist", "index.js");
  const agentPath = path.join(ROOT, "apps", "agent", "dist", "index.js");
  if (!fs.existsSync(gatewayPath)) fail("构建", "缺少 apps/gateway/dist/index.js，请先 npm run build");
  if (!fs.existsSync(agentPath)) fail("构建", "缺少 apps/agent/dist/index.js，请先 npm run build");

  const gatewayChild = spawn(process.execPath, [gatewayPath], {
    env: { ...process.env, GATEWAY_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
    cwd: ROOT,
  });
  gatewayChild.stderr?.on("data", (d) => process.stderr.write(d));
  gatewayChild.stdout?.on("data", (d) => process.stdout.write(d));
  await new Promise((r) => setTimeout(r, 1500));

  const health = await callGateway<{ ok?: boolean }>({ url: gwUrl, method: "health", timeoutMs: 5000 });
  if (!health?.ok) fail("Gateway health", "未返回 ok");
  ok("Gateway 已启动");

  await callGateway({
    url: gwUrl,
    method: "connect",
    params: { role: "operator", deviceId: "test-file-upload" },
    timeoutMs: 5000,
  });
  ok("connect 成功");

  const agentEnv = {
    ...process.env,
    GATEWAY_WS_URL: gwUrl,
    GATEWAY_URL: gwUrl,
    AGENT_ID: ".first_paramecium",
    AGENT_DIR: path.join(ROOT, ".first_paramecium"),
  };
  const agentChild = spawn(process.execPath, [agentPath], {
    env: agentEnv,
    stdio: ["ignore", "pipe", "pipe"],
    cwd: ROOT,
  });
  agentChild.stderr?.on("data", (d) => process.stderr.write(d));
  agentChild.stdout?.on("data", (d) => process.stdout.write(d));
  await new Promise((r) => setTimeout(r, 3000));

  const agents = await callGateway<{ agents?: Array<{ agentId?: string }> }>({
    url: gwUrl,
    method: "agents.list",
    timeoutMs: 5000,
  });
  if (!agents?.agents?.some((a) => a.agentId === ".first_paramecium")) {
    fail("Agent 未连接", "agents.list 中无 .first_paramecium");
  }
  ok("Agent .first_paramecium 已连接");

  const content = Buffer.from("hello upload test").toString("base64");
  const uploadRes = await callGateway<{ path?: string }>({
    url: gwUrl,
    method: "file.upload",
    params: { agentId: ".first_paramecium", filename: "test.txt", content },
    timeoutMs: 15_000,
  });

  if (!uploadRes?.path || typeof uploadRes.path !== "string") {
    fail("file.upload 返回", "缺少 path，得到 " + JSON.stringify(uploadRes));
  }
  if (!uploadRes.path.includes(".uagent_tmp")) {
    fail("file.upload 路径", "path 应含 .uagent_tmp，得到 " + uploadRes.path);
  }
  ok("file.upload 返回 path 含 .uagent_tmp: " + uploadRes.path);

  agentChild.kill("SIGTERM");
  gatewayChild.kill("SIGTERM");
  console.log("\n=== 测试通过 ===\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
