import { useState, useEffect, useCallback, useMemo } from "react";
import { gatewayClient } from "../gateway-client";
import type { NodeItem, SessionPreview } from "../types";

type NodeListPayload = { nodes?: NodeItem[] };

/** 有心跳即在线：与通讯录一致，90 秒内有心跳为在线 */
const ONLINE_THRESHOLD_MS = 90_000;

function isOnline(lastHeartbeatAt?: number): boolean {
  if (lastHeartbeatAt == null) return false;
  return Date.now() - lastHeartbeatAt < ONLINE_THRESHOLD_MS;
}

/** 从 sessionKey 解析 agentId：agent:.u:s-xxx -> .u；connector:feishu:chat:xxx -> .u */
function agentIdFromSessionKey(key: string): string {
  if (key.startsWith("connector:")) return ".u";
  const parts = key.split(":");
  return parts[1] ?? ".u";
}

/** 是否为群聊会话：connector 的 chat 或 channel 含 group */
function isGroupSession(s: SessionPreview): boolean {
  if (s.key.startsWith("connector:") && s.key.includes(":chat:")) return true;
  if (s.channel && /group|群/i.test(s.channel)) return true;
  return false;
}

type ListItem =
  | { type: "agent"; agentId: string; lastHeartbeatAt?: number; sortAt: number }
  | { type: "group"; session: SessionPreview; sortAt: number };

function getReadKeyForItem(agentId: string, sessionKey?: string): string {
  return sessionKey?.trim() || `agent:${agentId}:main`;
}

type Props = {
  selectedAgentId?: string | null;
  selectedSessionKey?: string | null;
  lastReadMap?: Record<string, number>;
  onOpenChat: (agentId: string, sessionKey?: string) => void;
  onNewGroup?: () => void;
};

export function ConversationListPanel({
  selectedAgentId,
  selectedSessionKey,
  lastReadMap = {},
  onOpenChat,
  onNewGroup,
}: Props) {
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [sessions, setSessions] = useState<SessionPreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    setErr(null);
    setLoading(true);
    Promise.all([
      gatewayClient.request<NodeListPayload>("node.list"),
      gatewayClient.request<{ sessions: SessionPreview[] }>("sessions.list"),
    ])
      .then(([nr, sr]) => {
        const payload = nr.ok && nr.payload ? (nr.payload as NodeListPayload) : {};
        setNodes(Array.isArray(payload.nodes) ? payload.nodes : []);
        if (sr.ok && sr.payload?.sessions) {
          setSessions(sr.payload.sessions as SessionPreview[]);
        } else setSessions([]);
      })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** 按最近聊天排序的列表：智能体（取该 agent 最近会话时间）+ 群聊会话，与微信一致 */
  const recentList = useMemo(() => {
    const agentMap = new Map<string, { lastHeartbeatAt?: number; latestUpdatedAt: number }>();
    for (const n of nodes) {
      for (const a of n.agents ?? []) {
        const cur = agentMap.get(a.agentId);
        const t = a.lastHeartbeatAt;
        if (!cur) {
          agentMap.set(a.agentId, { lastHeartbeatAt: t, latestUpdatedAt: 0 });
        } else if (t != null && (cur.lastHeartbeatAt == null || t > cur.lastHeartbeatAt)) {
          cur.lastHeartbeatAt = t;
        }
      }
    }
    for (const s of sessions) {
      if (!s.key.startsWith("agent:")) continue;
      const agentId = agentIdFromSessionKey(s.key);
      const u = s.updatedAt ?? 0;
      const cur = agentMap.get(agentId);
      if (cur) {
        if (u > cur.latestUpdatedAt) cur.latestUpdatedAt = u;
      } else {
        agentMap.set(agentId, { latestUpdatedAt: u });
      }
    }
    const items: ListItem[] = [];
    for (const [agentId, v] of agentMap) {
      items.push({ type: "agent", agentId, lastHeartbeatAt: v.lastHeartbeatAt, sortAt: v.latestUpdatedAt });
    }
    for (const s of sessions.filter(isGroupSession)) {
      items.push({ type: "group", session: s, sortAt: s.updatedAt ?? 0 });
    }
    items.sort((a, b) => b.sortAt - a.sortAt);
    return items;
  }, [nodes, sessions]);

  if (loading) {
    return (
      <div className="conversation-list-panel">
        <p className="loading">加载中…</p>
      </div>
    );
  }
  if (err) {
    return (
      <div className="conversation-list-panel">
        <p className="error">加载失败: {err}</p>
        <button type="button" className="chat-refresh-btn" onClick={load}>
          重试
        </button>
      </div>
    );
  }

  const isSelected = (agentId: string, sk?: string) =>
    selectedAgentId === agentId && (sk == null ? selectedSessionKey == null : selectedSessionKey === sk);

  return (
    <div className="conversation-list-panel">
      <section className="conversation-list-section">
        <div className="conversation-list-section-head">
          <h3 className="conversation-list-section-title">最近聊天</h3>
          {onNewGroup && (
            <button type="button" className="conversation-list-new-btn" onClick={onNewGroup}>
              + 新建群聊
            </button>
          )}
        </div>
        {recentList.length === 0 ? (
          <p className="conversation-list-empty">暂无聊天</p>
        ) : (
          <ul className="conversation-list">
            {recentList.map((item) => {
              if (item.type === "agent") {
                const readKey = getReadKeyForItem(item.agentId, undefined);
                const unread = item.sortAt > (lastReadMap[readKey] ?? 0);
                return (
                  <li key={`agent-${item.agentId}`} className="conversation-list-item">
                    <button
                      type="button"
                      className={`conversation-list-btn ${isSelected(item.agentId, undefined) ? "active" : ""}`}
                      onClick={() => onOpenChat(item.agentId)}
                    >
                      <span className={`conversation-list-dot ${isOnline(item.lastHeartbeatAt) ? "online" : ""}`} title={isOnline(item.lastHeartbeatAt) ? "在线" : "离线"} />
                      {unread && <span className="conversation-list-unread" title="未读" />}
                      <span className="conversation-list-label">{item.agentId}</span>
                      {item.sortAt > 0 && (
                        <span className="conversation-list-meta">
                          {new Date(item.sortAt).toLocaleDateString()}
                        </span>
                      )}
                    </button>
                  </li>
                );
              }
              const s = item.session;
              const aid = agentIdFromSessionKey(s.key);
              const readKey = getReadKeyForItem(aid, s.key);
              const unread = (s.updatedAt ?? 0) > (lastReadMap[readKey] ?? 0);
              return (
                <li key={`group-${s.key}`} className="conversation-list-item">
                  <button
                    type="button"
                    className={`conversation-list-btn ${isSelected(aid, s.key) ? "active" : ""}`}
                    onClick={() => onOpenChat(aid, s.key)}
                  >
                    {unread && <span className="conversation-list-unread" title="未读" />}
                    <span className="conversation-list-label">
                      {s.displayName || s.key.replace(/^connector:[^:]+:chat:/, "群 ") || s.sessionId?.slice(0, 8) || s.key}
                    </span>
                    <span className="conversation-list-meta">
                      {s.updatedAt ? new Date(s.updatedAt).toLocaleDateString() : ""}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
