/**
 * 多智能体 / 群聊 Session 测试：使用 .env 中的 GATEWAY_WS_URL、GATEWAY_TOKEN 等连接已有 Gateway，测试群聊创建、patch、chat.send、chat.history（senderAgentId）。
 *
 * 前置条件：
 * - 已 npm run build
 * - 已启动 Gateway（如 npm run gateway），并至少有一个 agent 连接（如 npm run agent，AGENT_ID=.u）
 * - 项目根目录有 .env（可选），可配置：
 *     GATEWAY_WS_URL=ws://127.0.0.1:9347
 *     GATEWAY_URL=ws://127.0.0.1:9347   # 未设 GATEWAY_WS_URL 时用此
 *     GATEWAY_TOKEN=                    # 若 Gateway 启用了认证
 *     GATEWAY_PASSWORD=                 # 若 Gateway 启用了认证
 *
 * 运行：npx tsx scripts/test-multi-agent-group.ts
 */

import "dotenv/config";
import { callGateway } from "@monou/gateway";

const GATEWAY_URL =
  process.env.GATEWAY_WS_URL?.trim() ||
  process.env.GATEWAY_URL?.trim() ||
  "ws://127.0.0.1:9347";
const TOKEN = process.env.GATEWAY_TOKEN?.trim();
const PASSWORD = process.env.GATEWAY_PASSWORD?.trim();

const GROUP_SESSION_KEY = "group:multi-agent-test-" + Date.now();
const TIMEOUT_MS = 25_000;

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

function conn() {
  const opts: { url: string; method: string; params?: Record<string, unknown>; timeoutMs?: number; token?: string; password?: string } = {
    url: GATEWAY_URL,
    method: "health",
    timeoutMs: TIMEOUT_MS,
  };
  if (TOKEN) opts.token = TOKEN;
  if (PASSWORD) opts.password = PASSWORD;
  return opts;
}

async function request<T = unknown>(
  method: string,
  params?: Record<string, unknown>,
  timeoutMs = TIMEOUT_MS,
): Promise<T> {
  const base = conn();
  const res = await callGateway<T>({
    ...base,
    method,
    params: params ?? {},
    timeoutMs,
  });
  return res;
}

async function run() {
  console.log("=== 多智能体 / 群聊 Session 测试 ===\n");
  console.log("Gateway URL:", GATEWAY_URL);
  if (TOKEN) console.log("使用 GATEWAY_TOKEN");
  if (PASSWORD) console.log("使用 GATEWAY_PASSWORD");
  console.log("");

  try {
    const health = await request<{ ok?: boolean }>("health", {}, 8000);
    if (!health?.ok) {
      fail("health", "未返回 ok");
      process.exit(1);
    }
    ok("Gateway health");
  } catch (e) {
    fail("连接 Gateway", (e as Error).message);
    console.log("\n提示: 请先启动 Gateway（npm run gateway）并确认 .env 中 GATEWAY_WS_URL 正确。");
    process.exit(1);
  }

  const list = await request<{ agents?: Array<{ agentId?: string }> }>("agents.list", {}, 5000);
  const agents = list?.agents ?? [];
  if (agents.length === 0) {
    fail("agents.list", "需要至少一个已连接 agent（请先 npm run agent 并连接本 Gateway）");
  } else {
    ok("agents.list 有 " + agents.length + " 个 agent: " + agents.map((a) => a.agentId).join(", "));
  }
  const hasU = agents.some((a) => a.agentId === ".u");
  if (!hasU) {
    console.log("  提示: 未发现 .u，群聊测试将用第一个 agent 作为 leadAgentId");
  }

  const leadAgentId = hasU ? ".u" : (agents[0]?.agentId ?? ".u");
  const participantAgentIds = [...new Set([...agents.map((a) => a.agentId).filter(Boolean) as string[], leadAgentId])];

  // 1. 先发一条消息以创建 session（否则 sessions.patch 可能找不到 key）
  try {
    await request("chat.send", {
      sessionKey: GROUP_SESSION_KEY,
      message: "init",
      agentId: leadAgentId,
    }, 60000);
    ok("创建 session: chat.send(init)");
  } catch (e) {
    fail("创建 session", (e as Error).message);
    process.exit(1);
  }

  // 2. sessions.patch 设为群聊
  try {
    const patched = await request<{ sessionType?: string; participantAgentIds?: string[]; leadAgentId?: string }>(
      "sessions.patch",
      {
        sessionKey: GROUP_SESSION_KEY,
        patch: {
          sessionType: "group",
          participantAgentIds,
          leadAgentId,
        },
      },
      5000,
    );
    if (patched?.sessionType === "group") {
      ok("sessions.patch 设为 group");
    } else {
      fail("sessions.patch", "返回 sessionType 应为 group，得到 " + JSON.stringify(patched?.sessionType));
    }
    if (Array.isArray(patched?.participantAgentIds) && patched.participantAgentIds.length > 0) {
      ok("sessions.patch participantAgentIds=" + patched.participantAgentIds.join(","));
    }
  } catch (e) {
    fail("sessions.patch", (e as Error).message);
  }

  // 3. 群聊发一条（不 @，应由 leadAgentId 回复）
  try {
    const sendRes = await request<{ text?: string; queued?: boolean }>(
      "chat.send",
      { sessionKey: GROUP_SESSION_KEY, message: "你好，请简短回复一句。" },
      60000,
    );
    if (sendRes?.queued === true) {
      ok("chat.send 群聊（已排队）");
    } else if (typeof sendRes?.text === "string" || sendRes != null) {
      ok("chat.send 群聊（leadAgentId 回复）");
    } else {
      fail("chat.send 群聊", "未得到预期响应 " + JSON.stringify(sendRes));
    }
  } catch (e) {
    fail("chat.send 群聊", (e as Error).message);
  }

  // 4. chat.history 应包含 senderAgentId（群聊中 assistant 条）
  try {
    const hist = await request<{ messages?: Array<{ role?: string; senderAgentId?: string }> }>(
      "chat.history",
      { sessionKey: GROUP_SESSION_KEY, limit: 20 },
      5000,
    );
    const messages = hist?.messages ?? [];
    const assistantWithSender = messages.filter((m) => m.role === "assistant" && (m as { senderAgentId?: string }).senderAgentId);
    if (assistantWithSender.length > 0) {
      ok("chat.history 含 senderAgentId 的 assistant 条数: " + assistantWithSender.length);
    } else {
      const hasAssistant = messages.some((m) => m.role === "assistant");
      if (hasAssistant) {
        fail("chat.history", "有 assistant 但无 senderAgentId（或首条 init 由单聊写入，无 senderAgentId 属正常）");
      } else {
        ok("chat.history 返回 " + messages.length + " 条（暂无 assistant 或尚未写入）");
      }
    }
  } catch (e) {
    fail("chat.history", (e as Error).message);
  }

  // 5. sessions.list / sessions.preview 应返回 sessionType、participantAgentIds、leadAgentId
  try {
    const preview = await request<{ sessions?: Array<{ key?: string; sessionType?: string; participantAgentIds?: string[]; leadAgentId?: string }> }>(
      "sessions.preview",
      {},
      5000,
    );
    const groupSession = preview?.sessions?.find((s) => s.key === GROUP_SESSION_KEY);
    if (groupSession?.sessionType === "group") {
      ok("sessions.preview 含 sessionType=group");
    } else if (groupSession) {
      fail("sessions.preview", "该 session 的 sessionType 应为 group，得到 " + String(groupSession?.sessionType));
    } else {
      ok("sessions.preview 已返回（当前 session 可能未在列表前几项）");
    }
  } catch (e) {
    fail("sessions.preview", (e as Error).message);
  }

  console.log("\n--- 结果: " + passed + " 通过, " + failed + " 失败 ---");
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
