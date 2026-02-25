#!/usr/bin/env node
/**
 * 测试 chat.send 是否把 transcript 历史传给 agent（initialMessages）
 * 流程：先发第一句「你的soul里有什么」写入 transcript，再问「我刚才第一句问了你什么？」验证记忆。
 * 可检查 .gateway/sessions/transcripts/agent-.u-main.json 确认 transcript 内容。
 * 用法: node scripts/test-chat-memory.mjs
 */
import { callGateway } from "@monou/gateway";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const URL = process.env.GATEWAY_WS_URL || "ws://127.0.0.1:9347";
const SESSION_KEY = "agent:.u:main";
const TRANSCRIPT_PATH = join(process.cwd(), ".gateway/sessions/transcripts/agent-.u-main.json");

function chatSend(message) {
  return callGateway({
    url: URL,
    method: "chat.send",
    params: { sessionKey: SESSION_KEY, message },
    timeoutMs: 120000,
  }).catch((e) => {
    console.error("chat.send failed:", e.message);
    process.exit(1);
  });
}

function getText(res) {
  return res?.text ?? res?.replyText ?? (typeof res === "string" ? res : JSON.stringify(res ?? "", null, 2));
}

async function main() {
  // 1) 先发第一句，让 transcript 里有一条可回忆的“第一句”
  console.log("[1/2] 发送第一句: 你的soul里有什么？");
  const r1 = await chatSend("你的soul里有什么？");
  console.log("回复:", getText(r1).slice(0, 200) + (getText(r1).length > 200 ? "…" : ""));
  console.log("");

  // 2) 再问记忆：刚才第一句问了你什么？
  console.log("[2/2] 发送: 我刚才第一句问了你什么？");
  const res = await chatSend("我刚才第一句问了你什么？");
  const text = getText(res);
  console.log("回复:");
  console.log("---");
  console.log(text);
  console.log("---");

  const hasSoul = typeof text === "string" && (text.includes("soul") || text.includes("SOUL") || text.includes("你的soul"));
  if (hasSoul) {
    console.log("\n[OK] 记忆生效：agent 提到了第一句（soul）");
  } else {
    console.log("\n[?] 若回复未提到「你的soul里有什么」，请查看 agent 终端是否打印 initialMessages count");
  }

  // 检查 transcript 文件
  if (existsSync(TRANSCRIPT_PATH)) {
    const raw = readFileSync(TRANSCRIPT_PATH, "utf8");
    const lines = raw.trim().split("\n").filter(Boolean);
    const messageLines = lines.filter((l) => l.includes('"type":"message"'));
    console.log("\n[transcript] " + TRANSCRIPT_PATH + " 共 " + messageLines.length + " 条 message");
  }
}

main();
