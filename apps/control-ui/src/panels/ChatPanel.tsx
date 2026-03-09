import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { gatewayClient } from "../gateway-client";
import type { NodeItem, SessionPreview } from "../types";

type NodeListPayload = { nodes?: NodeItem[] };

function collectAgentIds(nodes: NodeItem[]): string[] {
  const set = new Set<string>();
  for (const n of nodes) {
    for (const a of n.agents ?? []) set.add(a.agentId);
  }
  return Array.from(set).sort();
}

/** 对话中 Markdown 支持图像模态：data URL 与 /api/screenshots/ 文件地址均可渲染 */
const markdownComponents = {
  img: ({ src, alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) => {
    const opts = gatewayClient.getOptions();
    const base =
      opts?.url
        ? new URL(opts.url.replace(/^ws/, "http")).origin
        : "";
    const resolvedSrc =
      src === "attachment:screenshot.png" && base
        ? base + "/api/screenshots/pending/latest"
        : src?.startsWith("/api/screenshots/") && base
          ? base + src
          : src;
    return (
      <img
        src={resolvedSrc}
        alt={alt ?? ""}
        className="chat-markdown-img"
        loading="lazy"
        {...props}
      />
    );
  },
};

type ToolCall = { id?: string; name: string; arguments?: string };
type RunDonePayload = { runId?: string; text?: string; toolCalls?: ToolCall[]; error?: string };

type ToolResultMessage = { role: "toolResult"; text: string; toolCallId?: string; isError?: boolean };

type ChatMessage =
  | { role: "user"; text: string }
  | { role: "agent"; text: string; toolCalls?: ToolCall[]; senderAgentId?: string }
  | ToolResultMessage;

type Props = {
  initialAgentId: string;
  initialSessionKey?: string;
  onOpenSession?: (agentId: string, sessionKey: string) => void; // 预留：从会话列表打开等
}

function sessionKeyPrefix(agentId: string): string {
  return `agent:${agentId}:`;
}

/** 是否为群聊会话（sessionKey 含 :group- 或 sessions 中 sessionType=group） */
function isGroupSessionKey(sessionKey: string, sessions: SessionPreview[]): boolean {
  if (sessionKey.includes(":group-")) return true;
  const s = sessions.find((x) => x.key === sessionKey);
  return s?.sessionType === "group" || false;
}

function sessionLabel(s: SessionPreview, prefix: string): string {
  return s.displayName || s.key.replace(prefix, "") || s.sessionId?.slice(0, 8) || "main";
}

function tryParseArgs(args?: string): unknown {
  if (!args || !args.trim()) return null;
  try {
    return JSON.parse(args);
  } catch {
    return args;
  }
}

/** 对话中展示时把「已上传文件」长路径缩短为「(已上传: 文件名)」，避免刷屏且保护路径 */
function shortenUploadHintInMessage(text: string): string {
  let out = text.replace(/\n\n\[已上传文件: ([^，]+)，路径: [^\]]+\]/g, (_, name) => `\n\n(已上传: ${name})`);
  out = out.replace(/^\[已上传文件: ([^，]+)，路径: [^\]]+\]$/, (_, name) => `(已上传: ${name})`);
  return out;
}

/** 将消息列表转为「展示块」：工具调用与对应结果合并为一张卡片 */
type DisplayBlock =
  | { kind: "user"; msg: ChatMessage }
  | { kind: "agent"; msg: ChatMessage }
  | { kind: "toolResult"; msg: ChatMessage }
  | { kind: "toolGroup"; text: string; toolCalls: ToolCall[]; results: ToolResultMessage[]; senderAgentId?: string };

function buildDisplayBlocks(messages: ChatMessage[]): DisplayBlock[] {
  const blocks: DisplayBlock[] = [];
  let i = 0;
  while (i < messages.length) {
    const msg = messages[i]!;
    if (msg.role === "user") {
      blocks.push({ kind: "user", msg });
      i += 1;
      continue;
    }
    if (msg.role === "toolResult") {
      blocks.push({ kind: "toolResult", msg });
      i += 1;
      continue;
    }
    if (msg.role === "agent" && msg.toolCalls?.length) {
      const n = msg.toolCalls.length;
      const results: ToolResultMessage[] = [];
      for (let j = i + 1; j < messages.length && results.length < n && messages[j]?.role === "toolResult"; j++) {
        results.push(messages[j] as ToolResultMessage);
      }
      blocks.push({
        kind: "toolGroup",
        text: msg.text ?? "",
        toolCalls: msg.toolCalls,
        results,
        ...(msg.senderAgentId && { senderAgentId: msg.senderAgentId }),
      });
      i += 1 + results.length;
      continue;
    }
    blocks.push({ kind: "agent", msg });
    i += 1;
  }
  return blocks;
}

/** 群聊邀请成员弹层：从 node.list 选未在群内的 agent，sessions.patch 追加 participantAgentIds */
function InviteToGroupModal({
  sessionKey,
  currentMemberIds,
  onDone,
  onCancel,
}: {
  sessionKey: string;
  currentMemberIds: string[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const memberSet = useMemo(() => new Set(currentMemberIds), [currentMemberIds]);
  const allIds = useMemo(() => collectAgentIds(nodes), [nodes]);
  const inviteCandidates = useMemo(() => allIds.filter((id) => !memberSet.has(id)), [allIds, memberSet]);

  useEffect(() => {
    setErr(null);
    setLoading(true);
    gatewayClient
      .request<NodeListPayload>("node.list")
      .then((res) => {
        const payload = res.ok && res.payload ? (res.payload as NodeListPayload) : {};
        setNodes(Array.isArray(payload.nodes) ? payload.nodes : []);
      })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const invite = (agentId: string) => {
    setInviting(true);
    const nextParticipants = [...currentMemberIds, agentId];
    gatewayClient
      .request("sessions.patch", { sessionKey, patch: { participantAgentIds: nextParticipants } })
      .then((res) => {
        if (res.ok) onDone();
        else setErr((res as { error?: { message?: string } }).error?.message ?? "邀请失败");
      })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setInviting(false));
  };

  return (
    <div className="invite-modal-overlay" role="dialog" aria-label="邀请成员进群">
      <div className="invite-modal">
        <div className="invite-modal-header">
          <span>邀请成员进群</span>
          <button type="button" className="invite-modal-close" onClick={onCancel} aria-label="关闭">×</button>
        </div>
        {loading && <p className="muted">加载成员列表…</p>}
        {err && <p className="error">{err}</p>}
        {!loading && inviteCandidates.length === 0 && (
          <p className="muted">当前在线的 agent 都已在本群内</p>
        )}
        {!loading && inviteCandidates.length > 0 && (
          <ul className="invite-modal-list">
            {inviteCandidates.map((id) => (
              <li key={id}>
                <button type="button" disabled={inviting} onClick={() => invite(id)}>{id}</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** 工具调用卡片：参考 Cursor 展示形式，整卡可折叠，摘要行显示 图标 + 工具名 + 状态 */
function ToolCard({
  call,
  result,
  components = markdownComponents,
}: {
  call: ToolCall;
  result: ToolResultMessage | undefined;
  components?: typeof markdownComponents;
}) {
  const args = call.arguments != null && call.arguments !== "" ? call.arguments : null;
  const parsed = args ? tryParseArgs(args) : null;
  const hasArgs = args && args.trim().length > 0;
  const state = result ? (result.isError ? "error" : "done") : "pending";
  const statusLabel = state === "pending" ? "执行中" : result?.isError ? "错误" : "完成";
  /** 有结果时默认折叠，保持列表紧凑；执行中时展开便于看到参数 */
  const defaultOpen = state === "pending";
  return (
    <details className={`tool-card tool-card--cursor-like`} data-state={state} open={defaultOpen}>
      <summary className="tool-card-summary">
        <span className="tool-card-icon" aria-hidden>
          <CursorToolIcon state={state} />
        </span>
        <span className="tool-card-name">{call.name}</span>
        <span className="tool-card-status" data-state={state}>
          {statusLabel}
        </span>
        <span className="tool-card-chevron" aria-hidden />
      </summary>
      <div className="tool-card-body">
        {hasArgs && (
          <details className="tool-card-args-wrap" open={state === "pending"}>
            <summary>参数</summary>
            <pre className="tool-card-args">
              {typeof parsed === "object" && parsed !== null
                ? JSON.stringify(parsed, null, 2)
                : args}
            </pre>
          </details>
        )}
        {result != null && (
          <div className={`tool-card-result ${result.isError ? "error" : ""}`}>
            <span className="tool-card-result-label">{result.isError ? "错误" : "返回"}</span>
            <div className="tool-card-result-body">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
                {result.text || "—"}
              </ReactMarkdown>
            </div>
          </div>
        )}
      </div>
    </details>
  );
}

function CursorToolIcon({ state }: { state: "pending" | "done" | "error" }) {
  if (state === "pending") return <span className="tool-icon-pending">◇</span>;
  if (state === "error") return <span className="tool-icon-error">!</span>;
  return <span className="tool-icon-done">✓</span>;
}

function ChatMessageBlock({ block }: { block: DisplayBlock }) {
  if (block.kind === "user") {
    return (
      <div className="chat-msg user">
        <div className="chat-msg-content">{shortenUploadHintInMessage(block.msg.text)}</div>
      </div>
    );
  }
  if (block.kind === "toolResult") {
    const msg = block.msg as ToolResultMessage;
    const state = msg.isError ? "error" : "done";
    return (
      <details className={`tool-card tool-card--cursor-like tool-card--result-only`} data-state={state}>
        <summary className="tool-card-summary">
          <span className="tool-card-icon" aria-hidden>
            <CursorToolIcon state={state} />
          </span>
          <span className="tool-card-name">{msg.isError ? "工具错误" : "工具返回"}</span>
          <span className="tool-card-status" data-state={state}>
            {msg.isError ? "错误" : "完成"}
          </span>
          <span className="tool-card-chevron" aria-hidden />
        </summary>
        <div className="tool-card-body">
          <div className="tool-card-result-body">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {msg.text || "—"}
            </ReactMarkdown>
          </div>
        </div>
      </details>
    );
  }
  if (block.kind === "agent") {
    const msg = block.msg;
    if (msg.role !== "agent") return null;
    return (
      <div className="chat-msg agent">
        {msg.senderAgentId && (
          <div className="chat-msg-sender" aria-label={`发送者: ${msg.senderAgentId}`}>
            {msg.senderAgentId}
          </div>
        )}
        <div className="chat-msg-content">
          {msg.text ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{msg.text}</ReactMarkdown>
          ) : (
            <span className="muted">—</span>
          )}
        </div>
      </div>
    );
  }
  const { text, toolCalls, results, senderAgentId } = block;
  return (
    <div className="tool-group">
      {text.trim() && (
        <div className="chat-msg agent">
          {senderAgentId && (
            <div className="chat-msg-sender" aria-label={`发送者: ${senderAgentId}`}>
              {senderAgentId}
            </div>
          )}
          <div className="chat-msg-content">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{text}</ReactMarkdown>
          </div>
        </div>
      )}
      <div className="tool-cards">
        {toolCalls.map((tc, j) => (
          <ToolCard key={tc.id ?? j} call={tc} result={results[j]} />
        ))}
      </div>
    </div>
  );
}

export function ChatPanel({ initialAgentId, initialSessionKey }: Props) {
  const [agentId, setAgentId] = useState(initialAgentId);
  const [sessions, setSessions] = useState<SessionPreview[]>([]);
  const [sessionKey, setSessionKey] = useState<string>(
    () => initialSessionKey || `agent:${initialAgentId || "default"}:main`,
  );
  const [isNewSession, setIsNewSession] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingText, setStreamingText] = useState("");
  /** 流式进行中收到的 tool_call（Cursor 风格：工具卡片随调用逐个出现） */
  const [streamingToolCalls, setStreamingToolCalls] = useState<ToolCall[]>([]);
  /** 流式阶段每个 toolCallId 对应的结果，由 run.progress 后 loadHistory 合并得到 */
  const [streamingToolResults, setStreamingToolResults] = useState<Record<string, { text: string; isError?: boolean }>>({});
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const loadingRef = useRef(false);
  /** 上传到 agent 侧 ~/.uagent_tmp 的文件（path 为 agent 本机路径），发送消息时会附带告知 agent */
  const [uploadedFile, setUploadedFile] = useState<{ path: string; filename: string } | null>(null);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const chunkBufferRef = useRef("");
  const chunkFlushRafRef = useRef<number | null>(null);
  const pendingRunEventsRef = useRef<Map<string, { chunks: string[]; toolCalls: ToolCall[]; done?: RunDonePayload }>>(new Map());
  /** 当前对话使用的 sessionKey，用于发送后从服务端重载历史（保证多轮一致） */
  const sessionKeyRef = useRef<string>("");
  /** 本轮发送是否为「新建会话」，run.done 后需清除并切到 main */
  const wasNewSessionRef = useRef(false);
  /** 点击「新建」时立即写入，发送时优先用此值，避免 setState 未 flush 仍用旧 key */
  const pendingNewSessionKeyRef = useRef<string | null>(null);
  /** 当前 runId 的 ref，在拿到 runId 时同步写入，避免 run.done 早于 effect 注册而漏接 */
  const currentRunIdRef = useRef<string | null>(null);
  /** 发送时记录的 sessionKey，run.done 时只有仍在该会话才追加回复，避免切走后回复加到别的会话 */
  const sentSessionKeyRef = useRef<string | null>(null);
  /** run.done 漏接时的轮询兜底：5s 后拉一次历史并结束「思考」 */
  const FALLBACK_MS = 5000;
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 当前消息条数，run.done 后 loadHistory 返回时只有不少于当前条数才应用，避免用旧数据覆盖刚追加的回复 */
  const messageCountRef = useRef(0);
  /** run.done 后延迟一次 loadHistory，确保按「写入之后再拉」拿到完整 transcript，避免首条回复不显示 */
  const loadAfterDoneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamDebugEnabledRef = useRef(false);
  const streamDebugLog = useCallback((event: string, data?: unknown) => {
    if (!streamDebugEnabledRef.current) return;
    const ts = new Date().toISOString();
    if (data === undefined) console.debug(`[chat-stream][${ts}] ${event}`);
    else console.debug(`[chat-stream][${ts}] ${event}`, data);
  }, []);
  const clearFallbackTimer = useCallback(() => {
    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
  }, []);
  const flushChunkBuffer = useCallback(() => {
    if (!chunkBufferRef.current) return;
    const chunk = chunkBufferRef.current;
    chunkBufferRef.current = "";
    setStreamingText((t) => t + chunk);
  }, []);
  const scheduleChunkFlush = useCallback(() => {
    if (chunkFlushRafRef.current != null) return;
    chunkFlushRafRef.current = window.requestAnimationFrame(() => {
      chunkFlushRafRef.current = null;
      flushChunkBuffer();
    });
  }, [flushChunkBuffer]);
  const clearChunkBuffer = useCallback(() => {
    chunkBufferRef.current = "";
    if (chunkFlushRafRef.current != null) {
      window.cancelAnimationFrame(chunkFlushRafRef.current);
      chunkFlushRafRef.current = null;
    }
  }, []);
  const clearPendingRunEvents = useCallback(() => {
    pendingRunEventsRef.current.clear();
  }, []);
  const bufferPendingRunChunk = useCallback((runId: string, chunk: string) => {
    const m = pendingRunEventsRef.current;
    const cur = m.get(runId) ?? { chunks: [], toolCalls: [] };
    cur.chunks.push(chunk);
    m.set(runId, cur);
  }, []);
  const bufferPendingRunToolCall = useCallback((runId: string, tc: ToolCall) => {
    const m = pendingRunEventsRef.current;
    const cur = m.get(runId) ?? { chunks: [], toolCalls: [] };
    cur.toolCalls.push(tc);
    m.set(runId, cur);
  }, []);
  const bufferPendingRunDone = useCallback((runId: string, done: RunDonePayload) => {
    const m = pendingRunEventsRef.current;
    const cur = m.get(runId) ?? { chunks: [], toolCalls: [] };
    cur.done = done;
    m.set(runId, cur);
  }, []);
  const consumePendingRunEvents = useCallback((runId: string) => {
    const cur = pendingRunEventsRef.current.get(runId);
    if (!cur) return undefined;
    pendingRunEventsRef.current.delete(runId);
    return cur;
  }, []);
  const scheduleFallbackHistorySync = useCallback((reason?: string) => {
    streamDebugLog("fallback.schedule", {
      reason: reason ?? "unknown",
      runId: currentRunIdRef.current,
      sessionKey: sessionKeyRef.current,
      timeoutMs: FALLBACK_MS,
    });
    clearFallbackTimer();
    fallbackTimerRef.current = setTimeout(() => {
      fallbackTimerRef.current = null;
      if (currentRunIdRef.current === null) return;
      const sk = sessionKeyRef.current;
      streamDebugLog("fallback.fire", {
        runId: currentRunIdRef.current,
        sessionKey: sk,
      });
      if (!sk) {
        // 保持流式状态，避免「中途消失」；仅等待 run.done 或后续事件收口
        return;
      }
      // 仅解除 loading、拉历史；不清 currentRunIdRef，以便稍后到达的 run.done 仍能追加回复，避免「思考中消失但回复不显示」
      gatewayClient
        .request<{ messages?: Array<{ role: string; content?: string; toolCalls?: ToolCall[]; senderAgentId?: string }> }>("chat.history", { sessionKey: sk, limit: 50 })
        .then((res) => {
          if (sessionKeyRef.current !== sk) return;
          if (!res.ok || !res.payload?.messages) return;
          streamDebugLog("fallback.history.loaded", {
            runId: currentRunIdRef.current,
            messageCount: res.payload.messages.length,
          });
          const loaded = res.payload.messages
            .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "toolResult")
            .map((m): ChatMessage => {
              const text = m.content ?? "";
              const mm = m as { isError?: boolean; toolCalls?: ToolCall[]; toolCallId?: string; senderAgentId?: string };
              if (m.role === "user") return { role: "user", text };
              if (m.role === "toolResult") return { role: "toolResult", text, ...(mm.toolCallId != null && { toolCallId: mm.toolCallId }), ...(mm.isError !== undefined && { isError: mm.isError }) };
              return { role: "agent", text, ...(mm.toolCalls?.length && { toolCalls: mm.toolCalls }), ...(mm.senderAgentId && { senderAgentId: mm.senderAgentId }) };
            });
          // fallback 仅在确认最终 assistant 已落盘时收口，否则只做同步
          const last = loaded[loaded.length - 1];
          const isFinalAssistant = !!last && last.role === "agent" && !(last as ChatMessage & { toolCalls?: ToolCall[] }).toolCalls?.length;
          if (isFinalAssistant && currentRunIdRef.current != null) {
            streamDebugLog("fallback.finish_from_history", {
              runId: currentRunIdRef.current,
              textLen: (last as { text?: string }).text?.length ?? 0,
            });
            setMessages(loaded);
            requestAnimationFrame(() => {
              currentRunIdRef.current = null;
              setCurrentRunId(null);
              setLoading(false);
              setStreamingText("");
              setStreamingToolCalls([]);
              setStreamingToolResults({});
            });
            return;
          }
          setMessages(loaded);
        })
        .catch(() => {
          streamDebugLog("fallback.history.error");
        });
    }, FALLBACK_MS);
  }, [clearFallbackTimer, streamDebugLog]);
  const isGroup = isGroupSessionKey(sessionKey, sessions);
  const prefix = sessionKeyPrefix(agentId);
  const mainSessionKey = `agent:${agentId}:main`;
  /** 单聊会话列表：只含该 agent 下的非群聊 session，群聊只出现在左侧「群聊」区块 */
  const agentSessions = sessions.filter(
    (s) => s.key.startsWith(prefix) && s.sessionType !== "group" && !s.key.includes(":group-"),
  );
  const hasMain = agentSessions.some((s) => s.key === mainSessionKey);
  const hasCurrentInList = agentSessions.some((s) => s.key === sessionKey);
  // 当前选中的会话若不在服务端列表里（例如刚发完消息尚未返回）也保留在列表中，避免「会话消失」
  const currentSessionPlaceholder =
    sessionKey &&
    sessionKey.startsWith(prefix) &&
    sessionKey !== mainSessionKey &&
    !hasCurrentInList
      ? [{ key: sessionKey, displayName: isNewSession ? "新会话" : (sessionKey.split(":").pop() ?? "会话"), sessionId: "" } as SessionPreview]
      : [];
  const sessionListItems = isGroup
    ? [] // 群聊不展示单聊会话列表
    : [
        ...(hasMain ? [] : [{ key: mainSessionKey, displayName: "main", sessionId: "" } as SessionPreview]),
        ...currentSessionPlaceholder,
        ...agentSessions,
      ];

  const groupSession = isGroup ? sessions.find((s) => s.key === sessionKey) : null;
  const groupMembers = groupSession?.participantAgentIds ?? [];
  const groupDisplayName = groupSession?.displayName || "群聊";
  const [showInviteModal, setShowInviteModal] = useState(false);

  const loadSessions = useCallback(() => {
    gatewayClient
      .request<{ sessions: SessionPreview[] }>("sessions.list")
      .then((res) => {
        if (res.ok && res.payload?.sessions) setSessions(res.payload.sessions);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (isNewSession) return;
    if (sessionKey?.includes(":group-")) return;
    const main = `agent:${agentId}:main`;
    if (!sessionKey || !sessionKey.startsWith(`agent:${agentId}:`)) {
      setSessionKey(main);
    }
  }, [agentId, isNewSession, sessionKey]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const loadHistory = useCallback(
    (sk: string, opts?: {
      onlyReplaceIfNonEmpty?: boolean;
      forceReplace?: boolean;
      /** 拉取成功后调用，用于流式阶段合并工具结果到 streamingToolResults */
      onLoaded?: (messages: ChatMessage[]) => void;
    }) => {
      if (!sk) {
        if (!opts?.onlyReplaceIfNonEmpty) setMessages([]);
        return;
      }
      setHistoryLoading(true);
      gatewayClient
        .request<{
          messages: Array<{
            role: string;
            content?: string;
            toolCalls?: ToolCall[];
            toolCallId?: string;
            isError?: boolean;
            senderAgentId?: string;
          }>;
        }>("chat.history", { sessionKey: sk, limit: 50 })
        .then((res) => {
          if (sessionKeyRef.current !== sk) return;
          if (res.ok && res.payload?.messages) {
            const loaded = res.payload.messages
              .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "toolResult")
              .map((m): ChatMessage => {
                const text = m.content ?? "";
                if (m.role === "user") return { role: "user", text };
                if (m.role === "toolResult") {
                  return {
                    role: "toolResult",
                    text,
                    toolCallId: m.toolCallId,
                    isError: m.isError,
                  };
                }
                return {
                  role: "agent",
                  text,
                  ...(m.toolCalls?.length && { toolCalls: m.toolCalls }),
                  ...(m.senderAgentId && { senderAgentId: m.senderAgentId }),
                };
              });
            const forceReplace = opts?.forceReplace === true;
            // 仅当服务端消息数严格多于当前时替换，避免 run.done 刚追加回复后被 loadHistory 的旧数据覆盖（导致「回复总慢一句」）
            const notStale = opts?.onlyReplaceIfNonEmpty ? loaded.length > messageCountRef.current : loaded.length >= messageCountRef.current;
            const allowEmpty = !opts?.onlyReplaceIfNonEmpty;
            const safeToReplace = forceReplace ? loaded.length > 0 : (notStale && (allowEmpty || loaded.length > 0));
            if (safeToReplace) setMessages(loaded);
            opts?.onLoaded?.(loaded);
          } else if (!opts?.onlyReplaceIfNonEmpty) setMessages([]);
        })
        .catch(() => {
          if (sessionKeyRef.current !== sk) return;
          if (!opts?.onlyReplaceIfNonEmpty) setMessages([]);
        })
        .finally(() => setHistoryLoading(false));
    },
    []
  );

  /** 手动刷新当前会话历史（对齐 OpenClaw 的刷新行为） */
  const refreshCurrentSession = useCallback(() => {
    const sk = sessionKeyRef.current || "";
    loadHistory(sk, { forceReplace: true });
    loadSessions();
  }, [loadHistory, loadSessions]);

  sessionKeyRef.current = sessionKey;
  messageCountRef.current = messages.length;
  loadingRef.current = loading;

  /** 仅当从外部打开某会话时（props 变化）加载该会话历史；不依赖 sessionKey state，避免发送/run.done 后误触发 */
  useEffect(() => {
    setAgentId(initialAgentId);
    const sk = initialSessionKey || `agent:${initialAgentId || "default"}:main`;
    setSessionKey(sk);
    setIsNewSession(false);
    sessionKeyRef.current = sk;
    messageCountRef.current = 0;
    setErr(null);
    loadHistory(sk);
    // 写入后再拉：兜底首条（如上线招呼）在打开前刚写入 transcript 的情况；多拉一次以等到招呼回复（agent 用 chat.send 发招呼可能需数秒）
    const t1 = setTimeout(() => {
      if (sessionKeyRef.current === sk) loadHistory(sk, { onlyReplaceIfNonEmpty: true });
    }, 600);
    const t2 = setTimeout(() => {
      if (sessionKeyRef.current === sk) loadHistory(sk, { onlyReplaceIfNonEmpty: true });
    }, 2500);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [initialAgentId, initialSessionKey, loadHistory]);

  const streamingResultCount = Object.keys(streamingToolResults).length;
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText, streamingToolCalls.length, streamingResultCount]);

  /** 生成新建会话的唯一 sessionKey（格式 agent:id:s-<time>-<random>） */
  const generateNewSessionKey = useCallback(() => {
    const suffix = `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    return `agent:${agentId}:${suffix}`;
  }, [agentId]);

  const handleDeleteSession = (key: string, e: React.MouseEvent) => {
    e.stopPropagation();
    gatewayClient
      .request("sessions.delete", { sessionKey: key })
      .then((res) => {
        if (!res.ok) return;
        loadSessions();
        if (sessionKey === key) {
          const main = mainSessionKey;
          sessionKeyRef.current = main;
          setSessionKey(main);
          setIsNewSession(false);
          setErr(null);
          messageCountRef.current = 0;
          setMessages([]);
          loadHistory(main);
        }
      })
      .catch(() => {});
  };

  const handleSelectSession = (key: string) => {
    if (key === "__new__") {
      const newKey = generateNewSessionKey();
      pendingNewSessionKeyRef.current = newKey;
      sessionKeyRef.current = newKey; // 立即更新，避免进行中的 loadHistory 完成后覆盖空历史
      setSessionKey(newKey);
      setIsNewSession(true);
      setMessages([]);
      return;
    }
    pendingNewSessionKeyRef.current = null;
    sessionKeyRef.current = key;
    setIsNewSession(false);
    setSessionKey(key);
    setErr(null);
    setMessages([]); // 先清空，避免在加载时仍显示上一会话内容
    clearFallbackTimer();
    currentRunIdRef.current = null;
    setCurrentRunId(null);
    loadingRef.current = false;
    setLoading(false);
    clearPendingRunEvents();
    clearChunkBuffer();
    setStreamingText("");
    setStreamingToolCalls([]);
    setStreamingToolResults({});
    // 切换会话时必须用服务端历史覆盖，否则会被 render 里的 messageCountRef 覆盖导致不应用
    loadHistory(key, { forceReplace: true });
  };

  const handleFileUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const onFileSelected = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file || !agentId) return;
      setUploadErr(null);
      setUploadLoading(true);
      const reader = new FileReader();
      reader.onload = () => {
        const data = reader.result as string;
        const marker = "base64,";
        const idx = typeof data === "string" ? data.indexOf(marker) : -1;
        if (idx < 0) {
          setUploadErr("文件编码失败：未识别到 base64 数据");
          setUploadLoading(false);
          return;
        }
        const base64 = data.slice(idx + marker.length).trim();
        if (!base64) {
          setUploadErr("文件编码失败：内容为空");
          setUploadLoading(false);
          return;
        }
        gatewayClient
          .request<{ path?: string }>("file.upload", { agentId, filename: file.name, content: base64 })
          .then((res) => {
            if (res.ok && res.payload?.path) {
              setUploadedFile({ path: res.payload.path, filename: file.name });
            } else {
              setUploadErr((res as { error?: { message?: string } }).error?.message ?? "上传失败");
            }
          })
          .catch((err) => setUploadErr((err as Error).message))
          .finally(() => setUploadLoading(false));
      };
      reader.onerror = () => {
        setUploadErr("文件读取失败");
        setUploadLoading(false);
      };
      reader.readAsDataURL(file);
    },
    [agentId],
  );

  const abortRun = useCallback(() => {
    if (currentRunId) {
      if (fallbackTimerRef.current) {
        clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
      gatewayClient.request("chat.abort", { runId: currentRunId }).catch(() => {});
      currentRunIdRef.current = null;
      setCurrentRunId(null);
      loadingRef.current = false;
      setLoading(false);
      clearPendingRunEvents();
      clearChunkBuffer();
      setStreamingText("");
      setStreamingToolCalls([]);
      setStreamingToolResults({});
    }
  }, [clearChunkBuffer, clearPendingRunEvents, currentRunId]);

  // runId 存在时轮询 chat.history：若 run.done 未到达（如 broadcast 丢失），也能从历史同步出回复
  const POLL_INTERVAL_MS = 2000;
  useEffect(() => {
    const enabled =
      typeof window !== "undefined" &&
      (window.localStorage.getItem("CHAT_STREAM_DEBUG") === "1" ||
        window.localStorage.getItem("chat.stream.debug") === "1");
    streamDebugEnabledRef.current = enabled;
    if (enabled) {
      streamDebugLog("debug.enabled", {
        hint: "localStorage.CHAT_STREAM_DEBUG=1 或 localStorage['chat.stream.debug']=1",
      });
    }
  }, [streamDebugLog]);

  useEffect(() => {
    if (currentRunId == null) clearChunkBuffer();
  }, [clearChunkBuffer, currentRunId]);

  useEffect(() => {
    if (!currentRunId) return;
    streamDebugLog("poll.start", { runId: currentRunId, sessionKey: sessionKeyRef.current });
    const poll = () => {
      if (currentRunIdRef.current === null) return;
      const sk = sessionKeyRef.current;
      if (!sk || sk.includes(":group-")) return;
      gatewayClient
        .request<{ messages?: Array<{ role: string; content?: string; toolCalls?: ToolCall[]; toolCallId?: string; isError?: boolean; senderAgentId?: string }> }>("chat.history", {
          sessionKey: sk,
          limit: 50,
        })
        .then((res) => {
          if (currentRunIdRef.current === null) return;
          if (sessionKeyRef.current !== sk) return;
          if (!res.ok || !res.payload?.messages) return;
          streamDebugLog("poll.history.loaded", {
            runId: currentRunIdRef.current,
            messageCount: res.payload.messages.length,
          });
          const loaded = res.payload.messages
            .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "toolResult")
            .map((m): ChatMessage => {
              const text = m.content ?? "";
              const mm = m as { isError?: boolean; toolCalls?: ToolCall[]; toolCallId?: string; senderAgentId?: string };
              if (m.role === "user") return { role: "user", text };
              if (m.role === "toolResult") return { role: "toolResult", text, ...(mm.toolCallId != null && { toolCallId: mm.toolCallId }), ...(mm.isError !== undefined && { isError: mm.isError }) };
              return { role: "agent", text, ...(mm.toolCalls?.length && { toolCalls: mm.toolCalls }), ...(mm.senderAgentId && { senderAgentId: mm.senderAgentId }) };
            });
          const last = loaded[loaded.length - 1];
          const isFinalAssistant = !!last && last.role === "agent" && !(last as ChatMessage & { toolCalls?: ToolCall[] }).toolCalls?.length;
          if (isFinalAssistant && currentRunIdRef.current != null) {
            streamDebugLog("poll.finish_from_history", {
              runId: currentRunIdRef.current,
              textLen: (last as { text?: string }).text?.length ?? 0,
            });
            setMessages(loaded);
            requestAnimationFrame(() => {
              currentRunIdRef.current = null;
              setCurrentRunId(null);
              loadingRef.current = false;
              setLoading(false);
              setStreamingText("");
              setStreamingToolCalls([]);
              setStreamingToolResults({});
            });
            return;
          }
          if (loaded.length > messageCountRef.current) setMessages(loaded);
        })
        .catch(() => {});
    };
    const t = setInterval(poll, POLL_INTERVAL_MS);
    poll();
    return () => {
      streamDebugLog("poll.stop", { runId: currentRunIdRef.current });
      clearInterval(t);
    };
  }, [currentRunId, streamDebugLog]);

  // 只注册一次 run.chunk / run.done / run.progress / run.tool_call，用 ref 判断 runId（Cursor 风格：流式文本 + 工具卡片逐个出现）
  useLayoutEffect(() => {
    const unStarted = gatewayClient.onEvent("agent.run.started", (payload: unknown) => {
      const p = payload as { runId?: string };
      const rid = currentRunIdRef.current;
      if (rid != null && String(p?.runId) === String(rid)) {
        streamDebugLog("event.started", { runId: rid });
        clearChunkBuffer();
        setStreamingText("");
        setStreamingToolCalls([]);
        setStreamingToolResults({});
      }
    });
    const unChunk = gatewayClient.onEvent("agent.run.chunk", (payload: unknown) => {
      const p = payload as { runId?: string; chunk?: string };
      const rid = currentRunIdRef.current;
      if (rid != null && typeof p.chunk === "string") {
        if (p?.runId != null && String(p.runId) !== String(rid)) {
          streamDebugLog("event.chunk.runid_mismatch", { expected: rid, got: p.runId });
        }
        streamDebugLog("event.chunk", { runId: rid, chunkLen: p.chunk.length });
        scheduleFallbackHistorySync("chunk");
        chunkBufferRef.current += p.chunk;
        scheduleChunkFlush();
      } else if (rid == null && loadingRef.current && typeof p.chunk === "string" && typeof p.runId === "string" && p.runId.trim()) {
        bufferPendingRunChunk(p.runId, p.chunk);
        streamDebugLog("event.chunk.buffered_before_runid", { runId: p.runId, chunkLen: p.chunk.length });
      }
    });
    const unToolCall = gatewayClient.onEvent("agent.run.tool_call", (payload: unknown) => {
      const p = payload as { runId?: string; toolCall?: { id?: string; name?: string; arguments?: string } };
      const rid = currentRunIdRef.current;
      if (!p?.toolCall) return;
      if (rid == null) {
        if (loadingRef.current && typeof p?.runId === "string" && p.runId.trim()) {
          bufferPendingRunToolCall(p.runId, { id: p.toolCall.id ?? "", name: p.toolCall.name ?? "", arguments: p.toolCall.arguments });
          streamDebugLog("event.tool_call.buffered_before_runid", { runId: p.runId, toolName: p.toolCall.name ?? "" });
        }
        return;
      }
      if (p?.runId != null && String(p.runId) !== String(rid)) {
        streamDebugLog("event.tool_call.runid_mismatch", { expected: rid, got: p.runId });
      }
      streamDebugLog("event.tool_call", { runId: rid, toolName: p.toolCall.name ?? "" });
      scheduleFallbackHistorySync("tool_call");
      const tc = p.toolCall;
      setStreamingToolCalls((prev) => [
        ...prev,
        { id: tc.id ?? "", name: tc.name ?? "", arguments: tc.arguments },
      ]);
    });
    const unProgress = gatewayClient.onEvent("agent.run.progress", (payload: unknown) => {
      const p = payload as { runId?: string; sessionKey?: string };
      if (!p?.sessionKey || sessionKeyRef.current !== p.sessionKey) return;
      streamDebugLog("event.progress", { runId: p.runId, sessionKey: p.sessionKey });
      if (currentRunIdRef.current != null) scheduleFallbackHistorySync("progress");
      loadHistory(p.sessionKey, {
        onlyReplaceIfNonEmpty: true,
        onLoaded: (loaded) => {
          if (currentRunIdRef.current == null) return;
          // 从历史末尾取连续 toolResult，再向前找到带 toolCalls 的 assistant（跳过中间的「仅文本」assistant）
          let i = loaded.length - 1;
          const toolResults: ToolResultMessage[] = [];
          while (i >= 0) {
            const m = loaded[i];
            if (m?.role === "toolResult") {
              toolResults.unshift(m as ToolResultMessage);
              i--;
            } else break;
          }
          while (i >= 0) {
            const m = loaded[i];
            if (m?.role === "agent" && (m as ChatMessage & { toolCalls?: ToolCall[] }).toolCalls?.length) break;
            i--;
          }
          const lastAssistant = loaded[i];
          const toolCalls = lastAssistant?.role === "agent" ? (lastAssistant as ChatMessage & { toolCalls?: ToolCall[] }).toolCalls : undefined;
          if (!toolCalls?.length || toolResults.length === 0) return;
          const byId: Record<string, { text: string; isError?: boolean }> = {};
          for (const res of toolResults) {
            const id = res.toolCallId ?? "";
            if (id) byId[id] = { text: res.text, isError: res.isError };
          }
          setStreamingToolResults((prev) => ({ ...prev, ...byId }));
        },
      });
    });
    const unDone = gatewayClient.onEvent("agent.run.done", (payload: unknown) => {
      const p = payload as RunDonePayload;
      const rid = currentRunIdRef.current;
      if (rid == null) {
        if (loadingRef.current && typeof p?.runId === "string" && p.runId.trim()) {
          bufferPendingRunDone(p.runId, p);
          streamDebugLog("event.done.buffered_before_runid", { runId: p.runId, textLen: (p.text ?? "").length });
        }
        return;
      }
      if (String(p?.runId) !== String(rid)) return;
      flushChunkBuffer();
      streamDebugLog("event.done", {
        runId: rid,
        textLen: (p.text ?? "").length,
        toolCallCount: p.toolCalls?.length ?? 0,
        hasError: !!p.error,
      });
      clearFallbackTimer();
      const replyText = p.error ? `[错误] ${p.error}` : ((p.text ?? "") || "(无文本回复)");
      const sk = sessionKeyRef.current;
      const sameSession = sk === sentSessionKeyRef.current;
      if (sameSession) {
        setMessages((m) => [
          ...m,
          { role: "agent", text: replyText, ...(p.toolCalls?.length && { toolCalls: p.toolCalls }) },
        ]);
        setStreamingText(replyText);
      }
      requestAnimationFrame(() => {
        currentRunIdRef.current = null;
        setCurrentRunId(null);
              loadingRef.current = false;
        setLoading(false);
        setStreamingText("");
        setStreamingToolCalls([]);
        setStreamingToolResults({});
      });
      if (sameSession) {
        loadHistory(sk, { onlyReplaceIfNonEmpty: true });
        if (loadAfterDoneTimerRef.current) clearTimeout(loadAfterDoneTimerRef.current);
        loadAfterDoneTimerRef.current = setTimeout(() => {
          loadAfterDoneTimerRef.current = null;
          if (sessionKeyRef.current === sk) loadHistory(sk, { onlyReplaceIfNonEmpty: true });
        }, 350);
      }
      if (wasNewSessionRef.current) {
        wasNewSessionRef.current = false;
        pendingNewSessionKeyRef.current = null;
        setIsNewSession(false);
        loadSessions();
      }
    });
    return () => {
      unStarted();
      unChunk();
      unToolCall();
      unProgress();
      unDone();
      clearFallbackTimer();
      clearPendingRunEvents();
      clearChunkBuffer();
      if (loadAfterDoneTimerRef.current) {
        clearTimeout(loadAfterDoneTimerRef.current);
        loadAfterDoneTimerRef.current = null;
      }
    };
  }, [bufferPendingRunChunk, bufferPendingRunDone, bufferPendingRunToolCall, clearChunkBuffer, clearFallbackTimer, clearPendingRunEvents, flushChunkBuffer, loadHistory, scheduleChunkFlush, scheduleFallbackHistorySync, streamDebugLog]);

  const send = async () => {
    let text = input.trim();
    if (uploadedFile) {
      text = text ? `${text}\n\n[已上传文件: ${uploadedFile.filename}，路径: ${uploadedFile.path}]` : `[已上传文件: ${uploadedFile.filename}，路径: ${uploadedFile.path}]`;
      setUploadedFile(null);
    }
    if (!text || loading) return;
    const replyAllMatch = /^\/all\s+/i.exec(text);
    const taskMatch = /^\/task\s+/i.exec(text);
    const useReplyModeAll = replyAllMatch != null;
    const useReplyModeTask = taskMatch != null;
    let messageBody = text;
    if (useReplyModeAll) messageBody = text.replace(/^\/all\s+/i, "").trim();
    else if (useReplyModeTask) messageBody = text.replace(/^\/task\s+/i, "").trim();
    const toSend = isNewSession ? `/new\n${messageBody}` : messageBody;
    const displayText = (messageBody.replace(/^\/(?:new|reset)\s*\n?/i, "").trim() || messageBody).replace(/\n\n\[已上传文件: ([^，]+)，路径: [^\]]+\]$/, (_, name) => `\n\n(已上传: ${name})`);
    const effectiveKey = isNewSession && pendingNewSessionKeyRef.current
      ? pendingNewSessionKeyRef.current
      : sessionKey;
    sessionKeyRef.current = effectiveKey;
    sentSessionKeyRef.current = effectiveKey;
    wasNewSessionRef.current = isNewSession;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: displayText }]);
    loadingRef.current = true;
    setLoading(true);
    setErr(null);
    clearPendingRunEvents();
    clearChunkBuffer();
    setStreamingText("");
    setStreamingToolCalls([]);
    setStreamingToolResults({});
    const isGroupSend = effectiveKey.includes(":group-");
    try {
      if (isGroupSend) {
        const sendParams: Record<string, unknown> = { message: toSend, sessionKey: effectiveKey };
        if (useReplyModeAll) sendParams.replyMode = "all";
        else if (useReplyModeTask) sendParams.replyMode = "task";
        const res = await gatewayClient.request<{ text?: string; toolCalls?: ToolCall[]; queued?: boolean; allReplied?: boolean; count?: number; taskDone?: boolean; rounds?: number }>("chat.send", sendParams);
        if (res.ok && res.payload) {
          const payload = res.payload as { text?: string; toolCalls?: ToolCall[]; queued?: boolean; allReplied?: boolean; count?: number; taskDone?: boolean; rounds?: number };
          if (payload.taskDone === true) {
            setLoading(false);
            loadHistory(effectiveKey, { forceReplace: true });
            return;
          }
          if (payload.allReplied === true) {
            setLoading(false);
            loadHistory(effectiveKey, { forceReplace: true });
            return;
          }
          if (payload.queued === true) {
            setMessages((m) => [...m, { role: "agent", text: "（已排队，稍候回复）" }]);
            const sk = effectiveKey;
            const poll = (n: number) => {
              if (n <= 0) {
                setLoading(false);
                return;
              }
              setTimeout(() => {
                if (sessionKeyRef.current !== sk) {
                  setLoading(false);
                  return;
                }
                gatewayClient
                  .request<{ messages?: Array<{ role: string; content?: string; toolCalls?: ToolCall[]; senderAgentId?: string }> }>("chat.history", { sessionKey: sk, limit: 50 })
                  .then((r) => {
                    if (sessionKeyRef.current !== sk) return;
                    if (r.ok && r.payload?.messages && r.payload.messages.length > messageCountRef.current + 2) {
                      const raw = r.payload.messages as Array<{ role: string; content?: string; toolCalls?: ToolCall[]; toolCallId?: string; isError?: boolean; senderAgentId?: string }>;
                      const loaded = raw
                        .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "toolResult")
                        .map((m): ChatMessage => {
                          const t = m.content ?? "";
                          if (m.role === "user") return { role: "user", text: t };
                          if (m.role === "toolResult") return { role: "toolResult", text: t, ...(m.toolCallId != null && { toolCallId: m.toolCallId }), ...(m.isError !== undefined && { isError: m.isError }) };
                          return { role: "agent", text: t, ...(m.toolCalls?.length && { toolCalls: m.toolCalls }), ...(m.senderAgentId && { senderAgentId: m.senderAgentId }) };
                        });
                      setMessages(loaded);
                    }
                    setLoading(false);
                  })
                  .catch(() => setLoading(false));
              }, 2000);
            };
            poll(5);
          } else {
            const replyText = (payload.text ?? "") || "(无文本回复)";
            setMessages((m) => [
              ...m,
              { role: "agent", text: replyText, ...(payload.toolCalls?.length && { toolCalls: payload.toolCalls }) },
            ]);
            setLoading(false);
            loadHistory(effectiveKey, { forceReplace: true });
          }
        } else {
          setErr((res as { error?: { message?: string } }).error?.message ?? "请求失败");
          setLoading(false);
          // 即使失败（如 504 超时）也拉一次历史，展示已通过 progress 写入的 tool 调用，避免「工具已写入 transcript 但前端没展示」
          loadHistory(effectiveKey, { forceReplace: true });
        }
        return;
      }
      const params: Record<string, unknown> = { message: toSend, agentId };
      if (effectiveKey) params.sessionKey = effectiveKey;
      const res = await gatewayClient.request<{ runId?: string; text?: string }>("agent", params);
      if (res.ok && res.payload) {
        const runId = (res.payload as { runId?: string }).runId;
        const reply = (res.payload as { text?: string }).text;
        if (runId) {
          const runIdStr = String(runId);
          currentRunIdRef.current = runIdStr;
          setCurrentRunId(runId);
          streamDebugLog("send.run_started", {
            runId: runIdStr,
            sessionKey: effectiveKey,
            textLen: messageBody.length,
          });
          const pending = consumePendingRunEvents(runIdStr);
          if (pending) {
            if (pending.chunks.length > 0) {
              const joined = pending.chunks.join("");
              chunkBufferRef.current += joined;
              scheduleChunkFlush();
              streamDebugLog("event.chunk.replayed_after_runid", { runId: runIdStr, chunkCount: pending.chunks.length, textLen: joined.length });
            }
            if (pending.toolCalls.length > 0) {
              setStreamingToolCalls((prev) => [...prev, ...pending.toolCalls]);
            }
            if (pending.done) {
              const done = pending.done;
              streamDebugLog("event.done.replayed_after_runid", { runId: runIdStr, textLen: (done.text ?? "").length });
              flushChunkBuffer();
              const replyText = done.error ? `[错误] ${done.error}` : ((done.text ?? "") || "(无文本回复)");
              const sk = sessionKeyRef.current;
              const sameSession = sk === sentSessionKeyRef.current;
              if (sameSession) {
                setMessages((m) => [
                  ...m,
                  { role: "agent", text: replyText, ...(done.toolCalls?.length && { toolCalls: done.toolCalls }) },
                ]);
                setStreamingText(replyText);
              }
              requestAnimationFrame(() => {
                currentRunIdRef.current = null;
                setCurrentRunId(null);
                loadingRef.current = false;
                setLoading(false);
                setStreamingText("");
                setStreamingToolCalls([]);
                setStreamingToolResults({});
              });
              return;
            }
          }
          if (reply) setStreamingText(reply);
          scheduleFallbackHistorySync("run_started");
        } else {
          // Gateway 的 agent 方法在 agent 跑完后才 resolve，无 runId；直接拉完整历史，使工具调用与「点击进入」界面一致（含 toolResult）
          const payload = res.payload as { text?: string; toolCalls?: ToolCall[] };
          const replyText = (payload?.text ?? "") || "(无文本回复)";
          setMessages((m) => [
            ...m,
            {
              role: "agent",
              text: replyText,
              ...(payload?.toolCalls?.length && { toolCalls: payload.toolCalls }),
            },
          ]);
          setLoading(false);
          loadHistory(effectiveKey, { forceReplace: true });
        }
        if (isNewSession) {
          pendingNewSessionKeyRef.current = null;
          setIsNewSession(false);
          setSessionKey(effectiveKey);
          loadSessions();
        }
      } else {
        setErr(res.error?.message ?? "请求失败");
        setLoading(false);
        // 失败时仍拉历史，展示可能已写入的 tool 调用（如 progress 已推送）
        loadHistory(effectiveKey, { forceReplace: true });
      }
    } catch (e) {
      setErr((e as Error).message);
      setLoading(false);
      loadHistory(effectiveKey, { forceReplace: true });
    }
  };

  return (
    <div className="chat-view">
      <aside className="chat-sidebar">
        <div className="chat-sidebar-section">
          <div className="chat-sidebar-label-row">
            <span className="chat-sidebar-label">{isGroup ? "群聊" : "会话"}</span>
            <span className="chat-sidebar-actions">
              <button
                type="button"
                className="chat-refresh-btn"
                onClick={refreshCurrentSession}
                title="刷新当前会话历史"
                aria-label="刷新"
              >
                ↻
              </button>
              {!isGroup && (
                <button
                  type="button"
                  className="chat-new-session-btn"
                  onClick={() => handleSelectSession("__new__")}
                >
                  + 新建
                </button>
              )}
            </span>
          </div>
          <ul className="chat-session-list">
            {sessionListItems.map((s) => (
              <li key={s.key} className="chat-session-row">
                <button
                  type="button"
                  className={`chat-session-item ${sessionKey === s.key ? "active" : ""}`}
                  onClick={() => handleSelectSession(s.key)}
                >
                  {sessionLabel(s, prefix)}
                </button>
                <button
                  type="button"
                  className="chat-session-delete"
                  onClick={(e) => handleDeleteSession(s.key, e)}
                  title="删除会话"
                  aria-label="删除会话"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="chat-sidebar-footer">
          <span className="chat-history-hint" title="会话历史与列表均在 .gateway/sessions/（transcripts/*.json、sessions.json）">
            历史: .gateway/sessions/transcripts/
          </span>
        </div>
      </aside>
      <div className="chat-main">
        <div className="chat-area">
          <header className="chat-agent-header" aria-live="polite">
            {isGroup ? (
              <>
                <div className="chat-group-header-row">
                  <div className="chat-group-title-wrap">
                    <div className="chat-group-title">{groupDisplayName}</div>
                    {groupMembers.length > 0 && (
                      <div className="chat-group-members" title={`共 ${groupMembers.length} 人`}>
                        {groupMembers.map((id) => (
                          <span key={id} className="chat-group-member-tag">
                            {id}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    className="chat-invite-btn"
                    onClick={() => setShowInviteModal(true)}
                    title="邀请成员进群"
                  >
                    邀请成员
                  </button>
                </div>
              </>
            ) : (
              "对话"
            )}
          </header>
          <div className="chat-messages">
            {historyLoading && <p className="muted">加载历史…</p>}
            {!historyLoading && messages.length === 0 && !streamingText && (
              <p className="empty">发送一条消息开始对话</p>
            )}
            {buildDisplayBlocks(messages).map((block, i) => (
              <ChatMessageBlock key={i} block={block} />
            ))}
            {/* Cursor 风格：流式区域 = 流式文本 + 进行中的工具卡片（仅在有 currentRunId 时显示，避免 run.done 后残留） */}
            {currentRunId && (loading || streamingText || streamingToolCalls.length > 0) ? (
              <div className="tool-group streaming-block">
                <div className="chat-msg agent streaming">
                  <div className="chat-msg-content">
                    {streamingText ? (
                      <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{streamingText}</div>
                    ) : (
                      <span className="muted">正在接收回复…</span>
                    )}
                  </div>
                  <span className="chat-cursor" aria-hidden />
                </div>
                {streamingToolCalls.length > 0 && (
                  <div className="tool-cards">
                    {streamingToolCalls.map((tc, j) => (
                      <ToolCard
                        key={tc.id || j}
                        call={tc}
                        result={
                          tc.id && streamingToolResults[tc.id]
                            ? { role: "toolResult", text: streamingToolResults[tc.id].text, isError: streamingToolResults[tc.id].isError }
                            : undefined
                        }
                      />
                    ))}
                  </div>
                )}
              </div>
            ) : null}
            {loading && !currentRunId && (
              <div className="chat-msg agent">
                <div className="chat-msg-content">思考中…</div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
          {err && <p className="error chat-error">{err}</p>}
          {uploadErr && <p className="error chat-error" style={{ fontSize: "0.85rem" }}>{uploadErr}</p>}
          {uploadedFile && (
            <div className="chat-uploaded-chip" style={{ marginBottom: "0.25rem", fontSize: "0.85rem" }}>
              <span className="muted">已上传: {uploadedFile.filename}</span>
              <button type="button" onClick={() => setUploadedFile(null)} aria-label="清除">×</button>
            </div>
          )}
          <form
            className="chat-form"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              style={{ display: "none" }}
              onChange={onFileSelected}
              disabled={uploadLoading}
            />
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={isGroup ? "输入消息… /all 让所有人回复 /task 发布任务轮转完成" : "输入消息…（Enter 发送，Shift+Enter 换行）"}
              disabled={loading}
              rows={1}
            />
            {loading ? (
              <button type="button" className="chat-stop-btn" onClick={abortRun}>
                停止
              </button>
            ) : (
              <>
                <button type="submit">发送</button>
                <button type="button" onClick={handleFileUpload} disabled={uploadLoading} title="上传到当前 Agent 的 ~/.uagent_tmp">
                  {uploadLoading ? "上传中…" : "上传文件"}
                </button>
              </>
            )}
          </form>
        </div>
      </div>
      {isGroup && showInviteModal && (
        <InviteToGroupModal
          sessionKey={sessionKey}
          currentMemberIds={groupMembers}
          onDone={() => {
            setShowInviteModal(false);
            loadSessions();
          }}
          onCancel={() => setShowInviteModal(false)}
        />
      )}
    </div>
  );
}
