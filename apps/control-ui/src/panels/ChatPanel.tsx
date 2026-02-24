import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { gatewayClient } from "../gateway-client";
import type { SessionPreview } from "../types";

type ToolCall = { id?: string; name: string; arguments?: string };

type ToolResultMessage = { role: "toolResult"; text: string; toolCallId?: string; isError?: boolean };

type ChatMessage =
  | { role: "user"; text: string }
  | { role: "agent"; text: string; toolCalls?: ToolCall[] }
  | ToolResultMessage;

type Props = {
  initialAgentId: string;
  initialSessionKey?: string;
  onOpenSession?: (agentId: string, sessionKey: string) => void; // 预留：从会话列表打开等
}

function sessionKeyPrefix(agentId: string): string {
  return `agent:${agentId}:`;
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
  | { kind: "toolGroup"; text: string; toolCalls: ToolCall[]; results: ToolResultMessage[] };

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
      });
      i += 1 + results.length;
      continue;
    }
    blocks.push({ kind: "agent", msg });
    i += 1;
  }
  return blocks;
}

function ToolCard({ call, result }: { call: ToolCall; result: ToolResultMessage | undefined }) {
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
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{result.text || "—"}</ReactMarkdown>
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
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.text || "—"}</ReactMarkdown>
        </div>
      </div>
    );
  }
  if (block.kind === "agent") {
    const msg = block.msg;
    if (msg.role !== "agent") return null;
    return (
      <div className="chat-msg agent">
        <div className="chat-msg-content">
          {msg.text ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.text}</ReactMarkdown>
          ) : (
            <span className="muted">—</span>
          )}
        </div>
      </div>
    );
  }
  const { text, toolCalls, results } = block;
  return (
    <div className="tool-group">
      {text.trim() && (
        <div className="chat-msg agent">
          <div className="chat-msg-content">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
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
    () => initialSessionKey || `agent:${initialAgentId || ".u"}:main`
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
  const prefix = sessionKeyPrefix(agentId);
  const mainSessionKey = `agent:${agentId}:main`;
  const agentSessions = sessions.filter((s) => s.key.startsWith(prefix));
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
  const sessionListItems = [
    ...(hasMain ? [] : [{ key: mainSessionKey, displayName: "main", sessionId: "" } as SessionPreview]),
    ...currentSessionPlaceholder,
    ...agentSessions,
  ];

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
    const sk = initialSessionKey || `agent:${initialAgentId || ".u"}:main`;
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
    const toSend = isNewSession ? `/new\n${text}` : text;
    // 展示用：去掉 /new、/reset 前缀，避免气泡里出现指令
    const displayText = text.replace(/^\/(?:new|reset)\s*\n?/i, "").trim() || text;
    // 新建时优先用 ref（点击新建时已写入），避免 state 未更新仍发到 main
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
    try {
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
          // 若 run.done 未收到（如连接/广播问题），2.5s 后拉一次历史并结束「思考」
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
              .request<{ messages?: Array<{ role: string; content?: string; toolCalls?: ToolCall[] }> }>("chat.history", { sessionKey: sk, limit: 50 })
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
                    return { role: "agent", text, ...((m as { toolCalls?: ToolCall[] }).toolCalls?.length && { toolCalls: (m as { toolCalls?: ToolCall[] }).toolCalls }) };
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
          setSessionKey(effectiveKey); // 确保 UI 停留在新建的会话
          loadSessions();
          // 不在此处 loadHistory，避免覆盖刚展示的消息（服务端可能尚未写完 transcript）
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
          <label className="chat-sidebar-label">Agent</label>
          <input
            type="text"
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            placeholder=".u"
            className="chat-agent-input"
          />
        </div>
        <div className="chat-sidebar-section">
          <div className="chat-sidebar-label-row">
            <span className="chat-sidebar-label">会话</span>
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
              <button
                type="button"
                className="chat-new-session-btn"
                onClick={() => handleSelectSession("__new__")}
              >
                + 新建
              </button>
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
            与 <strong>{agentId || ".u"}</strong> 对话
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
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamingText}</ReactMarkdown>
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
              placeholder="输入消息…"
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
    </div>
  );
}
