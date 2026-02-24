import { useState, useEffect, useCallback } from "react";
import { gatewayClient } from "../gateway-client";
import type { SessionPreview } from "../types";

/** 从 sessionKey 解析 agentId，格式 agent:.u:s-xxx -> .u */
function agentIdFromKey(key: string): string {
  const parts = key.split(":");
  return parts[1] ?? "";
}

type Props = {
  onOpenSession: (agentId: string, sessionKey: string) => void;
};

export function SessionsPanel({ onOpenSession }: Props) {
  const [sessions, setSessions] = useState<SessionPreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    setErr(null);
    gatewayClient
      .request<{ sessions: SessionPreview[] }>("sessions.list")
      .then((res) => {
        if (res.ok && res.payload?.sessions) setSessions(res.payload.sessions);
        else setSessions([]);
      })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <p className="loading">加载中…</p>;
  if (err) return <p className="error">加载失败: {err}</p>;

  return (
    <div className="card">
      <h3>会话列表</h3>
      <p className="muted" style={{ fontSize: "0.85rem", marginBottom: "0.75rem" }}>
        点击会话在「对话」中打开
      </p>
      {sessions.length === 0 ? (
        <p className="empty">暂无会话</p>
      ) : (
        <ul className="session-list">
          {sessions.map((s) => (
            <li key={s.key} className="session-list-item">
              <button
                type="button"
                className="session-list-btn"
                onClick={() => onOpenSession(agentIdFromKey(s.key), s.key)}
              >
                <span className="session-key">{s.displayName || s.key}</span>
                <span className="muted" style={{ fontSize: "0.8rem" }}>
                  {s.updatedAt ? new Date(s.updatedAt).toLocaleString() : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
