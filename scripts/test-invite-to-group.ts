/**
 * 测试「拉人进群」：sessions.patch 直接创建群聊（无 chat.send 前置），再 sessions.patch 追加成员。
 * 仅需 Gateway 启动，无需 agent 连接。
 * 运行：npx tsx scripts/test-invite-to-group.ts
 */

import "dotenv/config";
import { callGateway } from "@monou/gateway";

const GATEWAY_URL =
  process.env.GATEWAY_WS_URL?.trim() ||
  process.env.GATEWAY_URL?.trim() ||
  "ws://127.0.0.1:9347";
const TOKEN = process.env.GATEWAY_TOKEN?.trim();
const PASSWORD = process.env.GATEWAY_PASSWORD?.trim();
const TIMEOUT_MS = 15_000;

function conn() {
  const opts: {
    url: string;
    method: string;
    params?: Record<string, unknown>;
    timeoutMs?: number;
    token?: string;
    password?: string;
  } = { url: GATEWAY_URL, method: "health", timeoutMs: TIMEOUT_MS };
  if (TOKEN) opts.token = TOKEN;
  if (PASSWORD) opts.password = PASSWORD;
  return opts;
}

async function request<T = unknown>(
  method: string,
  params?: Record<string, unknown>,
  timeoutMs = TIMEOUT_MS,
): Promise<T> {
  const res = await callGateway<T>({
    ...conn(),
    method,
    params: params ?? {},
    timeoutMs,
  });
  return res;
}

async function run() {
  console.log("=== 拉人进群（sessions.patch）测试 ===\n");
  console.log("Gateway URL:", GATEWAY_URL);

  const initialParticipants = [".first_paramecium"];
  const leadAgentId = initialParticipants[0]!;
  const sessionKey = `agent:${leadAgentId}:group-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const newMember = "code_engineer";
  const afterInvite = [...initialParticipants, newMember];

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

  try {
    const health = await request<{ ok?: boolean }>("health", {}, 8000);
    if (!health?.ok) {
      fail("health", "未返回 ok");
      process.exit(1);
    }
    ok("Gateway health");
  } catch (e) {
    fail("连接 Gateway", (e as Error).message);
    console.log("\n请先启动 Gateway: npm run gateway");
    process.exit(1);
  }

  // 1. sessions.patch 直接创建群聊（与 Control UI 新建群聊一致）
  try {
    const patched = await request<{
      sessionType?: string;
      participantAgentIds?: string[];
      leadAgentId?: string;
    }>("sessions.patch", {
      sessionKey,
      patch: {
        sessionType: "group",
        participantAgentIds: initialParticipants,
        leadAgentId: initialParticipants[0],
        displayName: "测试群",
      },
    }, 5000);
    if (patched?.sessionType === "group") {
      ok("sessions.patch 直接创建群聊 (sessionType=group)");
    } else {
      fail("sessions.patch 创建群聊", "sessionType 应为 group，得到 " + JSON.stringify(patched?.sessionType));
    }
    if (
      Array.isArray(patched?.participantAgentIds) &&
      patched.participantAgentIds.length === initialParticipants.length
    ) {
      ok("sessions.patch participantAgentIds=" + (patched.participantAgentIds?.join(",") ?? ""));
    }
  } catch (e) {
    fail("sessions.patch 创建群聊", (e as Error).message);
    console.log("\n--- 结果: " + passed + " 通过, " + failed + " 失败 ---");
    process.exit(failed > 0 ? 1 : 0);
  }

  // 2. sessions.patch 拉人进群（追加 participantAgentIds）
  try {
    const patched = await request<{ participantAgentIds?: string[] }>(
      "sessions.patch",
      {
        sessionKey,
        patch: { participantAgentIds: afterInvite },
      },
      5000,
    );
    const ids = patched?.participantAgentIds ?? [];
    if (ids.length === afterInvite.length && ids.includes(newMember)) {
      ok("sessions.patch 拉人进群 (participantAgentIds 已包含 " + newMember + ")");
    } else {
      fail("sessions.patch 拉人进群", "期望 " + afterInvite.join(",") + "，得到 " + ids.join(","));
    }
  } catch (e) {
    fail("sessions.patch 拉人进群", (e as Error).message);
  }

  // 3. sessions.list 能拿到该群且成员正确
  try {
    const list = await request<{
      sessions?: Array<{
        key?: string;
        sessionType?: string;
        participantAgentIds?: string[];
      }>;
    }>("sessions.list", {}, 5000);
    const session = list?.sessions?.find((s) => s.key === sessionKey);
    if (session?.participantAgentIds?.includes(newMember)) {
      ok("sessions.list 返回群聊且成员含新成员");
    } else if (session) {
      fail("sessions.list", "群聊 participantAgentIds 未含 " + newMember);
    } else {
      fail("sessions.list", "未找到 sessionKey " + sessionKey);
    }
  } catch (e) {
    fail("sessions.list", (e as Error).message);
  }

  console.log("\n--- 结果: " + passed + " 通过, " + failed + " 失败 ---");
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
