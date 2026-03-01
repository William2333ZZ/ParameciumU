/**
 * 场景测试：清空 agents/.gateway → 启动 Gateway → 启动 .first_paramecium → 用 .first_paramecium 创建 stock_learning → 由新 agent 执行任务（汇报、cron、chat）。
 *
 * 运行前先 build：npm run build
 * 运行：npx tsx scripts/test-scenario-stock-agent.ts
 */

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const STOCK_AGENT_ID = "stock_learning";
const REPORT_MESSAGE = "请汇报你当前关于股票与学习的思考与进展。";
const TEN_MIN_MS = 10 * 60 * 1000;

function clearAgentsDir(root: string): void {
  const agentsDir = path.join(root, "agents");
  if (!fs.existsSync(agentsDir)) return;
  for (const name of fs.readdirSync(agentsDir)) {
    fs.rmSync(path.join(agentsDir, name), { recursive: true, force: true });
  }
}

function clearGatewayData(root: string): void {
  const sessionsDir = path.join(root, ".gateway", "sessions");
  const transcriptsDir = path.join(sessionsDir, "transcripts");
  if (fs.existsSync(transcriptsDir)) {
    for (const name of fs.readdirSync(transcriptsDir)) {
      fs.unlinkSync(path.join(transcriptsDir, name));
    }
  }
  fs.mkdirSync(sessionsDir, { recursive: true });
  fs.writeFileSync(path.join(sessionsDir, "sessions.json"), "{}", "utf-8");
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer(() => {});
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = addr && typeof addr === "object" ? addr.port : 0;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

let passed = 0;
let failed = 0;
function ok(name: string) {
  passed++;
  console.log("  [OK]", name);
}
function fail(name: string, reason: string) {
  failed++;
  console.log("  [FAIL]", name, "-", reason);
}

async function run() {
  console.log("=== 场景测试：股票学习智能体（新 agent 执行任务）===\n");

  clearAgentsDir(ROOT);
  clearGatewayData(ROOT);
  ok("清空 agents/ 与 .gateway");

  const { callGateway } = await import("@monou/gateway");
  const port = await findFreePort();
  const gwUrl = `ws://127.0.0.1:${port}`;

  const gatewayPath = path.join(ROOT, "apps", "gateway", "dist", "index.js");
  const agentPath = path.join(ROOT, "apps", "agent", "dist", "index.js");
  if (!fs.existsSync(gatewayPath)) {
    fail("构建", "缺少 apps/gateway/dist/index.js，请先 npm run build");
    process.exit(1);
  }
  if (!fs.existsSync(agentPath)) {
    fail("构建", "缺少 apps/agent/dist/index.js，请先 npm run build");
    process.exit(1);
  }

  const gatewayChild = spawn(process.execPath, [gatewayPath], {
    env: { ...process.env, GATEWAY_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
    cwd: ROOT,
  });
  gatewayChild.stderr?.on("data", (d) => process.stderr.write(d));
  gatewayChild.stdout?.on("data", (d) => process.stdout.write(d));
  await new Promise((r) => setTimeout(r, 2000));

  const health = await callGateway<{ ok?: boolean }>({ url: gwUrl, method: "health", timeoutMs: 5000 });
  if (!health?.ok) {
    fail("Gateway health", "未返回 ok");
    process.exit(1);
  }
  ok("Gateway 已启动");

  await callGateway({
    url: gwUrl,
    method: "connect",
    params: { role: "operator", deviceId: "scenario-test" },
    timeoutMs: 5000,
  });

  const aiHub = process.env.AIHUBMIX_API_KEY ? process.env.AIHUBMIX_BASE_URL ?? "https://aihubmix.com/v1" : "";
  const agentEnv = {
    ...process.env,
    GATEWAY_URL: gwUrl,
    AGENT_ID: ".first_paramecium",
    AGENT_DIR: path.join(ROOT, ".first_paramecium"),
    ...(process.env.AIHUBMIX_API_KEY && { AIHUBMIX_BASE_URL: aiHub, AIHUBMIX_API_KEY: process.env.AIHUBMIX_API_KEY }),
  };

  const uChild = spawn(process.execPath, [agentPath], {
    env: agentEnv,
    stdio: ["ignore", "pipe", "pipe"],
    cwd: ROOT,
  });
  uChild.stderr?.on("data", (d) => process.stderr.write(d));
  uChild.stdout?.on("data", (d) => process.stdout.write(d));
  await new Promise((r) => setTimeout(r, 4000));

  let agents: Array<{ agentId?: string; deviceId?: string }> = [];
  for (let i = 0; i < 20; i++) {
    const list = await callGateway<{ agents?: Array<{ agentId?: string; deviceId?: string }> }>({
      url: gwUrl,
      method: "agents.list",
      timeoutMs: 3000,
    });
    agents = list?.agents ?? [];
    if (agents.some((a) => a.agentId === ".first_paramecium")) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  const uSlot = agents.find((a) => a.agentId === ".first_paramecium");
  if (!uSlot) {
    fail(".first_paramecium 连接", "agents.list 未发现 .first_paramecium");
    gatewayChild.kill();
    process.exit(1);
  }
  ok(".first_paramecium 已连接");

  const createMsg = `请用 agent-creator 技能创建智能体。要求：AGENT_ID=${STOCK_AGENT_ID}，GATEWAY_URL=${gwUrl}。在项目根目录执行：AGENT_ID=${STOCK_AGENT_ID} GATEWAY_URL=${gwUrl} ./.first_paramecium/skills/agent-creator/scripts/create-and-connect.sh`;
  const createRes = await callGateway<{ text?: string; toolCalls?: unknown[] }>({
    url: gwUrl,
    method: "agent",
    params: { message: createMsg, wait: true, agentId: ".first_paramecium", deviceId: uSlot.deviceId ?? uSlot.agentId },
    timeoutMs: 120000,
  });
  const hadReply = typeof createRes?.text === "string" || (Array.isArray(createRes?.toolCalls) && (createRes?.toolCalls?.length ?? 0) > 0);
  if (hadReply) ok(".first_paramecium 执行创建请求有回复");
  else fail(".first_paramecium 创建", "应返回 text 或 toolCalls");

  const stockDir = path.join(ROOT, "agents", STOCK_AGENT_ID);
  if (!fs.existsSync(stockDir) || !fs.statSync(stockDir).isDirectory()) {
    fail("agents/" + STOCK_AGENT_ID, "目录应在 .first_paramecium 执行脚本后存在");
  } else {
    ok("agents/" + STOCK_AGENT_ID + " 已创建");
  }

  for (let i = 0; i < 25; i++) {
    const list = await callGateway<{ agents?: Array<{ agentId?: string; deviceId?: string }> }>({
      url: gwUrl,
      method: "agents.list",
      timeoutMs: 3000,
    });
    const all = list?.agents ?? [];
    if (all.some((a) => a.agentId === STOCK_AGENT_ID)) {
      ok("stock_learning 已出现在 agents.list");
      break;
    }
    if (i === 24) fail("agents.list", "未发现 " + STOCK_AGENT_ID);
    await new Promise((r) => setTimeout(r, 1000));
  }

  const list2 = await callGateway<{ agents?: Array<{ agentId?: string; deviceId?: string }> }>({
    url: gwUrl,
    method: "agents.list",
    timeoutMs: 3000,
  });
  const stockSlot = (list2?.agents ?? []).find((a) => a.agentId === STOCK_AGENT_ID);
  const stockDeviceId = stockSlot?.deviceId ?? stockSlot?.agentId ?? "";
  if (!stockDeviceId) {
    fail("stock_learning deviceId", "无法获取");
    gatewayChild.kill();
    process.exit(1);
  }

  const stockCronPath = path.join(stockDir, "cron", "jobs.json");
  fs.mkdirSync(path.dirname(stockCronPath), { recursive: true });
  if (!fs.existsSync(stockCronPath)) {
    fs.writeFileSync(
      stockCronPath,
      JSON.stringify({ version: 1, jobs: [] }, null, 2),
      "utf-8",
    );
  }
  const { CronStore } = await import("@monou/cron");
  const stockCronStore = new CronStore(stockCronPath);
  await stockCronStore.add({
    name: "股票学习汇报-每10分钟",
    description: "每10分钟汇报思考",
    enabled: true,
    schedule: { kind: "every", everyMs: TEN_MIN_MS },
    payload: { kind: "agentTurn", message: REPORT_MESSAGE },
  });
  ok("新 agent 的 cron 已添加每10分钟汇报任务");

  const skillsRes = await callGateway<{ skillDirs?: string[]; tools?: string[] }>({
    url: gwUrl,
    method: "skills.status",
    params: { agentId: STOCK_AGENT_ID },
    timeoutMs: 10000,
  });
  const hasTools = Array.isArray(skillsRes?.tools) && skillsRes.tools.length > 0;
  if (hasTools) ok("skills.status(stock_learning) 返回工具列表");
  else if (Array.isArray(skillsRes?.skillDirs)) ok("skills.status(stock_learning) 返回 skillDirs");
  else fail("skills.status", "新 agent 应返回 skillDirs/tools");

  const sessionKey = "scenario-stock-" + Date.now();
  const reportRes = await callGateway<{ text?: string }>({
    url: gwUrl,
    method: "agent",
    params: {
      message: REPORT_MESSAGE,
      wait: true,
      agentId: STOCK_AGENT_ID,
      deviceId: stockDeviceId,
      sessionKey,
    },
    timeoutMs: 90000,
  });
  const reportText = typeof reportRes?.text === "string" ? reportRes.text : "";
  if (reportText.length > 0) ok("新 agent 汇报请求返回非空回复");
  else fail("新 agent 汇报", "应返回非空 text");

  const historyRes = await callGateway<{ messages?: Array<{ role: string; content?: string }> }>({
    url: gwUrl,
    method: "chat.history",
    params: { sessionKey, limit: 20 },
    timeoutMs: 5000,
  });
  const messages = historyRes?.messages ?? [];
  const fromStock = messages.length >= 2 && messages.some((m) => m.role === "assistant" && (m.content?.length ?? 0) > 0);
  if (fromStock) ok("chat.history 含新 agent 会话消息（远程 agent 已回写 transcript）");
  else if (messages.length > 0) ok("chat.history 有消息");
  else fail("chat.history", "应有该 session 的消息（Gateway 应在 agent RPC 回复后写入 transcript）");

  gatewayChild.kill();
  console.log("\n=== 合计 ===\n通过:", passed, "失败:", failed);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
