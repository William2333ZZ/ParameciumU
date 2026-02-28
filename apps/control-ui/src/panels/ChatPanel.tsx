import { useState, useRef, useEffect, useCallback, useMemo } from "react";
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
  return (
    <div className="tool-card" data-state={result ? (result.isError ? "error" : "done") : "pending"}>
      <div className="tool-card-header">
        <span className="tool-card-icon" aria-hidden>◇</span>
        <span className="tool-card-name">{call.name}</span>
      </div>
      {hasArgs && (
        <details className="tool-card-args-wrap">
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
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{result.text || "—"}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}

function ChatMessageBlock({ block }: { block: DisplayBlock }) {
  if (block.kind === "user") {
    return (
      <div className="chat-msg user">
        <div className="chat-msg-content">{block.msg.text}</div>
      </div>
    );
  }
  if (block.kind === "toolResult") {
    const msg = block.msg as ToolResultMessage;
    return (
      <div className={`tool-card tool-card--result-only ${msg.isError ? "error" : ""}`} data-state={msg.isError ? "error" : "done"}>
        <div className="tool-card-header">
          <span className="tool-card-icon" aria-hidden>◇</span>
          <span className="tool-card-name">{msg.isError ? "工具错误" : "工具返回"}</span>
        </div>
        <div className="tool-card-result-body">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{msg.text || "—"}</ReactMarkdown>
        </div>
      </div>
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
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
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
    (sk: string, opts?: { onlyReplaceIfNonEmpty?: boolean; forceReplace?: boolean }) => {
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
            const notStale = loaded.length >= messageCountRef.current;
            const allowEmpty = !opts?.onlyReplaceIfNonEmpty;
            if (forceReplace || (notStale && (allowEmpty || loaded.length > 0))) setMessages(loaded);
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
  }, [initialAgentId, initialSessionKey, loadHistory]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

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
    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
    currentRunIdRef.current = null;
    setCurrentRunId(null);
    setLoading(false);
    setStreamingText("");
    // 切换会话时必须用服务端历史覆盖，否则会被 render 里的 messageCountRef 覆盖导致不应用
    loadHistory(key, { forceReplace: true });
  };

  const abortRun = useCallback(() => {
    if (currentRunId) {
      if (fallbackTimerRef.current) {
        clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
      gatewayClient.request("chat.abort", { runId: currentRunId }).catch(() => {});
      currentRunIdRef.current = null;
      setCurrentRunId(null);
      setLoading(false);
      setStreamingText("");
    }
  }, [currentRunId]);

  // 只注册一次 run.chunk / run.done，用 ref 判断 runId，避免 run.done 早于 effect 触发而漏接导致一直「思考」
  useEffect(() => {
    const unChunk = gatewayClient.onEvent("agent.run.chunk", (payload: unknown) => {
      const p = payload as { runId?: string; chunk?: string };
      const rid = currentRunIdRef.current;
      if (rid != null && String(p?.runId) === String(rid) && typeof p.chunk === "string") {
        setStreamingText((t) => t + p.chunk);
      }
    });
    const unDone = gatewayClient.onEvent("agent.run.done", (payload: unknown) => {
      const p = payload as { runId?: string; text?: string; toolCalls?: ToolCall[] };
      const rid = currentRunIdRef.current;
      if (rid == null || String(p?.runId) !== String(rid)) return;
      if (fallbackTimerRef.current) {
        clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
      currentRunIdRef.current = null;
      setCurrentRunId(null);
      setLoading(false);
      setStreamingText("");
      // 参考 OpenClaw：先立即追加回复（展示无延迟），再拉历史与服务端同步；loadHistory 用 messageCountRef 避免覆盖
      if (sessionKeyRef.current === sentSessionKeyRef.current) {
        const replyText = (p.text ?? "") || "(无文本回复)";
        setMessages((m) => [
          ...m,
          { role: "agent", text: replyText, ...(p.toolCalls?.length && { toolCalls: p.toolCalls }) },
        ]);
        const sk = sessionKeyRef.current;
        // 仅当服务端条数不少于当前才覆盖，避免用未写完的 transcript 覆盖刚追加的回复（对齐 OpenClaw）
        loadHistory(sk, { onlyReplaceIfNonEmpty: true });
      }
      if (wasNewSessionRef.current) {
        wasNewSessionRef.current = false;
        pendingNewSessionKeyRef.current = null;
        setIsNewSession(false);
        loadSessions();
      }
    });
    return () => {
      unChunk();
      unDone();
    };
  }, []);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    const replyAllMatch = /^\/all\s+/i.exec(text);
    const taskMatch = /^\/task\s+/i.exec(text);
    const useReplyModeAll = replyAllMatch != null;
    const useReplyModeTask = taskMatch != null;
    let messageBody = text;
    if (useReplyModeAll) messageBody = text.replace(/^\/all\s+/i, "").trim();
    else if (useReplyModeTask) messageBody = text.replace(/^\/task\s+/i, "").trim();
    const toSend = isNewSession ? `/new\n${messageBody}` : messageBody;
    const displayText = messageBody.replace(/^\/(?:new|reset)\s*\n?/i, "").trim() || messageBody;
    const effectiveKey = isNewSession && pendingNewSessionKeyRef.current
      ? pendingNewSessionKeyRef.current
      : sessionKey;
    sessionKeyRef.current = effectiveKey;
    sentSessionKeyRef.current = effectiveKey;
    wasNewSessionRef.current = isNewSession;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: displayText }]);
    setLoading(true);
    setErr(null);
    setStreamingText("");
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
                      const loaded = (r.payload.messages as Array<{ role: string; content?: string; toolCalls?: ToolCall[]; senderAgentId?: string }>)
                        .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "toolResult")
                        .map((m): ChatMessage => {
                          const t = m.content ?? "";
                          if (m.role === "user") return { role: "user", text: t };
                          if (m.role === "toolResult") return { role: "toolResult", text: t };
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
          currentRunIdRef.current = String(runId);
          setCurrentRunId(runId);
          if (reply) setStreamingText(reply);
          if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
          fallbackTimerRef.current = setTimeout(() => {
            fallbackTimerRef.current = null;
            if (currentRunIdRef.current === null) return;
            const sk = sessionKeyRef.current;
            if (!sk) {
              currentRunIdRef.current = null;
              setCurrentRunId(null);
              setLoading(false);
              setStreamingText("");
              return;
            }
            gatewayClient
              .request<{ messages?: Array<{ role: string; content?: string; toolCalls?: ToolCall[]; senderAgentId?: string }> }>("chat.history", { sessionKey: sk, limit: 50 })
              .then((res) => {
                if (currentRunIdRef.current === null) return;
                if (sessionKeyRef.current !== sk) return;
                if (!res.ok || !res.payload?.messages) return;
                const loaded = res.payload.messages
                  .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "toolResult")
                  .map((m): ChatMessage => {
                    const text = m.content ?? "";
                    if (m.role === "user") return { role: "user", text };
                    if (m.role === "toolResult") return { role: "toolResult", text, isError: (m as { isError?: boolean }).isError };
                    return { role: "agent", text, ...((m as { toolCalls?: ToolCall[] }).toolCalls?.length && { toolCalls: (m as { toolCalls?: ToolCall[] }).toolCalls }), ...(m.senderAgentId && { senderAgentId: m.senderAgentId }) };
                  });
                currentRunIdRef.current = null;
                setCurrentRunId(null);
                setLoading(false);
                setStreamingText("");
                setMessages(loaded);
              })
              .catch(() => {
                if (currentRunIdRef.current !== null) {
                  currentRunIdRef.current = null;
                  setCurrentRunId(null);
                  setLoading(false);
                  setStreamingText("");
                }
              });
          }, FALLBACK_MS);
        } else {
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
      }
    } catch (e) {
      setErr((e as Error).message);
      setLoading(false);
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
            {streamingText && (
              <div className="chat-msg agent streaming">
                <div className="chat-msg-content">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{streamingText}</ReactMarkdown>
                </div>
                <span className="chat-cursor" />
              </div>
            )}
            {loading && !streamingText && (
              <div className="chat-msg agent">
                <div className="chat-msg-content">思考中…</div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
          {err && <p className="error chat-error">{err}</p>}
          <form
            className="chat-form"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={isGroup ? "输入消息… /all 让所有人回复 /task 发布任务轮转完成" : "输入消息…"}
              disabled={loading}
            />
            {loading ? (
              <button type="button" className="chat-stop-btn" onClick={abortRun}>
                停止
              </button>
            ) : (
              <button type="submit">发送</button>
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
