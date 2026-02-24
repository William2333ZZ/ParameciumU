/**
 * Transcript 持久化：JSONL 树形格式（pi 式）。
 * 每行一个 JSON：首行 session header，其余为 message 条目（id, parentId, type, message, timestamp）。
 * 通过 leafId 表示当前叶节点；加载时返回根到叶的线性消息列表，追加时只 append 新行并返回新 leafId。
 */

import fs from "node:fs";
import path from "node:path";
import { createId } from "@monou/shared";

export type StoredMessage = {
  role: "user" | "assistant" | "system" | "toolResult";
  content?: string;
  toolCalls?: Array<{ id: string; name: string; arguments?: string }>;
  toolCallId?: string;
  isError?: boolean;
};

const SESSION_VERSION = 2;

type SessionHeaderLine = {
  type: "session";
  version: number;
  id: string;
  createdAt: string;
};

type MessageEntryLine = {
  type: "message";
  id: string;
  parentId: string | null;
  timestamp: string;
  message: StoredMessage;
};

type TranscriptLine = SessionHeaderLine | MessageEntryLine;

function isMessageEntry(e: TranscriptLine): e is MessageEntryLine {
  return e.type === "message";
}

/**
 * 初始化新 transcript：写入一行 session header。文件不存在时创建。
 */
export function initTranscript(transcriptPath: string, sessionId: string): void {
  const dir = path.dirname(transcriptPath);
  fs.mkdirSync(dir, { recursive: true });
  const line: SessionHeaderLine = {
    type: "session",
    version: SESSION_VERSION,
    id: sessionId,
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(transcriptPath, JSON.stringify(line) + "\n", "utf-8");
}

/**
 * 从 JSONL 文件读取所有条目，建立 id -> entry 索引。
 */
function loadTranscriptLines(transcriptPath: string): TranscriptLine[] {
  if (!fs.existsSync(transcriptPath)) return [];
  const raw = fs.readFileSync(transcriptPath, "utf-8");
  const lines = raw.split("\n").filter((s) => s.trim());
  const out: TranscriptLine[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as TranscriptLine;
      if (parsed?.type === "session" || parsed?.type === "message") out.push(parsed);
    } catch {
      // skip malformed lines
    }
  }
  return out;
}

/**
 * 从根到指定 leaf 的路径上的 message 条目，按顺序返回 StoredMessage[]。
 * 若 leafId 为空或未找到，则返回根到「最后一条 message」的路径（兼容无 leafId 的旧逻辑此处已废弃，新逻辑始终有 leaf）。
 */
export function loadTranscript(transcriptPath: string, leafId?: string | null): StoredMessage[] {
  const lines = loadTranscriptLines(transcriptPath);
  const messageEntries = lines.filter(isMessageEntry);
  if (messageEntries.length === 0) return [];

  const byId = new Map<string, MessageEntryLine>();
  for (const e of messageEntries) byId.set(e.id, e);

  const pathIds: string[] = [];
  let current: string | null = leafId ?? null;
  if (!current && messageEntries.length > 0) {
    // no leafId: use last message as leaf (single branch)
    const last = messageEntries[messageEntries.length - 1]!;
    current = last.id;
  }
  while (current) {
    pathIds.unshift(current);
    const entry = byId.get(current);
    current = entry?.parentId ?? null;
  }

  return pathIds.map((id) => byId.get(id)!.message);
}

/**
 * 追加新消息到 transcript（append-only），parent 为当前 leafId（null 表示根）。
 * 返回最后一条新消息的 id，作为新的 leafId。
 */
export function appendTranscriptMessages(
  transcriptPath: string,
  parentLeafId: string | null,
  messages: StoredMessage[],
): string {
  const dir = path.dirname(transcriptPath);
  fs.mkdirSync(dir, { recursive: true });
  const existing = loadTranscriptLines(transcriptPath);
  const existingIds = new Set(
    existing.filter(isMessageEntry).map((e) => e.id),
  );
  let parentId: string | null = parentLeafId;
  let lastId = parentLeafId ?? "";
  for (const msg of messages) {
    const id = createId();
    const line: MessageEntryLine = {
      type: "message",
      id,
      parentId,
      timestamp: new Date().toISOString(),
      message: msg,
    };
    fs.appendFileSync(transcriptPath, JSON.stringify(line) + "\n", "utf-8");
    existingIds.add(id);
    parentId = id;
    lastId = id;
  }
  return lastId;
}

/**
 * 返回整棵树的条目列表 + header，供 sessions.getTree 使用。
 */
export function loadTranscriptTree(
  transcriptPath: string,
): { header: SessionHeaderLine | null; entries: MessageEntryLine[] } {
  const lines = loadTranscriptLines(transcriptPath);
  const header =
    lines.length > 0 && (lines[0] as TranscriptLine).type === "session"
      ? (lines[0] as SessionHeaderLine)
      : null;
  const entries = lines.filter(isMessageEntry);
  return { header, entries };
}

/**
 * 兼容旧 API：不再使用。新逻辑用 loadTranscript(path, leafId) + appendTranscriptMessages。
 * @deprecated
 */
export function saveTranscript(_transcriptPath: string, _messages: StoredMessage[]): void {
  // no-op; tree format is append-only
}

const CHAT_JSON = "chat.json";

export function resolveMainTranscriptPath(agentDir: string): string {
  return path.join(agentDir, CHAT_JSON);
}
