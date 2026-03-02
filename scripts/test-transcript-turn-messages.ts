#!/usr/bin/env npx tsx
/**
 * 测试「完整 turn 消息链」写入 transcript：远程 agent 返回 turnMessages 后，
 * transcript 应包含 assistant 的 tool_calls、tool_result，恢复会话时模型有上下文，不重复回复。
 *
 * 流程：启动 Gateway + Agent → 发一条触发 web_fetch 的消息 → 再发「所以你用 uv 来控制项目」
 *       → 检查 transcript 中是否出现 toolResult 或 toolCalls（证明整链已写入）。
 *
 * 运行：npm run build && npx tsx scripts/test-transcript-turn-messages.ts
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { callGateway } from "@monou/gateway";

const ROOT = path.resolve(new URL(import.meta.url).pathname, "../..");
// 使用独立端口避免与已有 Gateway 冲突，确保跑的是本次构建的 Gateway
const port = Number(process.env.GATEWAY_PORT) || 19347;
const gwUrl = `ws://127.0.0.1:${port}`;

function ok(msg: string) {
  console.log("[OK] " + msg);
}
function fail(label: string, detail: string) {
  console.error("[FAIL] " + label + ": " + detail);
  process.exit(1);
}

function getTranscriptPathForSessionKey(sessionKey: string): string {
  const safe = sessionKey.replace(/[^a-zA-Z0-9.-]/g, "-");
  return path.join(ROOT, ".gateway", "sessions", "transcripts", safe + ".json");
}

async function main() {
  console.log("=== 测试 transcript 完整 turn 消息链（turnMessages）===\n");

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
  await new Promise((r) => setTimeout(r, 2000));

  const health = await callGateway<{ ok?: boolean }>({ url: gwUrl, method: "health", timeoutMs: 5000 });
  if (!health?.ok) fail("Gateway health", "未返回 ok");
  ok("Gateway 已启动");

  await callGateway({
    url: gwUrl,
    method: "connect",
    params: { role: "operator", deviceId: "test-transcript" },
    timeoutMs: 5000,
  });

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
  await new Promise((r) => setTimeout(r, 4000));

  let agents: Array<{ agentId?: string }> = [];
  for (let i = 0; i < 20; i++) {
    const list = await callGateway<{ agents?: Array<{ agentId?: string }> }>({
      url: gwUrl,
      method: "agents.list",
      timeoutMs: 3000,
    });
    agents = list?.agents ?? [];
    if (agents.some((a) => a.agentId === ".first_paramecium")) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!agents.some((a) => a.agentId === ".first_paramecium")) {
    gatewayChild.kill();
    fail("Agent 连接", "agents.list 未发现 .first_paramecium");
  }
  ok(".first_paramecium 已连接");

  const sessionKey = "agent:.first_paramecium:test-turn-" + Date.now();
  const transcriptPath = getTranscriptPathForSessionKey(sessionKey);

  // 1) 发一条会触发 web_fetch 的消息
  console.log("\n[1/2] 发送: 请用 web_fetch 获取 https://www.runoob.com/python3/uv-tutorial.html 并简要总结");
  const r1 = await callGateway<{ text?: string }>({
    url: gwUrl,
    method: "chat.send",
    params: { sessionKey, message: "请用 web_fetch 获取 https://www.runoob.com/python3/uv-tutorial.html 并简要总结", agentId: ".first_paramecium" },
    timeoutMs: 120000,
  }).catch((e) => {
    gatewayChild.kill();
    agentChild.kill();
    fail("chat.send 1", (e as Error).message);
  });
  console.log("回复长度:", typeof r1?.text === "string" ? r1.text.length : 0);

  // 2) 追问：所以你用 uv 来控制项目（若 transcript 无完整链，模型可能重复贴 uv 教程）
  console.log("\n[2/2] 发送: 所以你用 uv 来控制项目");
  const r2 = await callGateway<{ text?: string }>({
    url: gwUrl,
    method: "chat.send",
    params: { sessionKey, message: "所以你用 uv 来控制项目", agentId: ".first_paramecium" },
    timeoutMs: 120000,
  }).catch((e) => {
    gatewayChild.kill();
    agentChild.kill();
    fail("chat.send 2", (e as Error).message);
  });
  console.log("回复长度:", typeof r2?.text === "string" ? r2.text.length : 0);

  // 3) 检查 transcript 是否包含 toolResult 或 toolCalls（证明整链已写入）
  if (!fs.existsSync(transcriptPath)) {
    gatewayChild.kill();
    agentChild.kill();
    fail("transcript", "文件不存在: " + transcriptPath);
  }
  const raw = fs.readFileSync(transcriptPath, "utf-8");
  const lines = raw.trim().split("\n").filter(Boolean);
  const hasToolResult = lines.some((l) => l.includes('"role":"toolResult"') || l.includes("toolResult"));
  const hasToolCalls = lines.some((l) => l.includes("toolCalls") && l.includes('"name"'));
  if (hasToolResult || hasToolCalls) {
    ok("transcript 含 tool 链：hasToolResult=" + hasToolResult + ", hasToolCalls=" + hasToolCalls);
  } else {
    console.error("\n[FAIL] transcript 中未发现 toolResult 或 toolCalls，整轮消息链可能未写入");
    console.error("transcript 行数:", lines.length);
    gatewayChild.kill();
    agentChild.kill();
    process.exit(1);
  }

  gatewayChild.kill();
  agentChild.kill();
  console.log("\n测试通过。");
}

main();
