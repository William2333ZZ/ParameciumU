import { useState, useEffect, useCallback } from "react";
import { gatewayClient } from "../gateway-client";
import type { NodeItem, CronJob, SessionPreview } from "../types";

type NodeListPayload = { nodes?: NodeItem[] };

const LOCAL_DEVICE_IDS = ["1270000001", "local"];

/** 节点展示名：本机或 nodeId */
function nodeDisplayName(n: NodeItem): string {
  if (n.deviceId && LOCAL_DEVICE_IDS.includes(n.deviceId)) return "本机";
  return n.nodeId;
}

/** 有心跳即在线：lastHeartbeatAt 在 90 秒内视为在线 */
const ONLINE_THRESHOLD_MS = 90_000;

function isOnline(lastHeartbeatAt?: number): boolean {
  if (lastHeartbeatAt == null) return false;
  return Date.now() - lastHeartbeatAt < ONLINE_THRESHOLD_MS;
}

function statusLabel(lastHeartbeatAt?: number): string {
  if (lastHeartbeatAt == null) return "离线";
  return isOnline(lastHeartbeatAt) ? "在线" : "离线";
}

function heartbeatHint(lastHeartbeatAt?: number): string {
  if (lastHeartbeatAt == null) return "无心跳";
  const sec = Math.floor((Date.now() - lastHeartbeatAt) / 1000);
  if (sec < 60) return "刚刚";
  if (sec < 3600) return `${Math.floor(sec / 60)} 分钟前`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} 小时前`;
  return `${Math.floor(sec / 86400)} 天前`;
}

/** 从 nodes 汇总 agentId -> 最新 lastHeartbeatAt（详情区用） */
function agentHeartbeatMap(nodes: NodeItem[]): Map<string, number | undefined> {
  const byId = new Map<string, number | undefined>();
  for (const n of nodes) {
    for (const a of n.agents ?? []) {
      const cur = byId.get(a.agentId);
      const t = a.lastHeartbeatAt;
      if (t != null && (cur == null || t > cur)) byId.set(a.agentId, t);
      else if (cur == null) byId.set(a.agentId, t);
    }
  }
  return byId;
}

type Props = {
  onOpenChat: (agentId: string, sessionKey?: string) => void;
};

export function ContactsPanel({ onOpenChat }: Props) {
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [sessions, setSessions] = useState<SessionPreview[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadNodes = useCallback(() => {
    setErr(null);
    setLoadingList(true);
    gatewayClient
      .request<NodeListPayload>("node.list")
      .then((res) => {
        const payload = res.ok && res.payload ? (res.payload as NodeListPayload) : {};
        setNodes(Array.isArray(payload.nodes) ? payload.nodes : []);
      })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoadingList(false));
  }, []);

  useEffect(() => {
    loadNodes();
  }, [loadNodes]);

  useEffect(() => {
    if (!selectedAgentId) {
      setJobs([]);
      setSessions([]);
      return;
    }
    setLoadingDetail(true);
    setErr(null);
    const prefix = `agent:${selectedAgentId}:`;
    Promise.all([
      gatewayClient.request<{ jobs: CronJob[] }>("cron.list", { agentId: selectedAgentId, includeDisabled: true }),
      gatewayClient.request<{ sessions: SessionPreview[] }>("sessions.list"),
    ])
      .then(([jr, sr]) => {
        setJobs(jr.ok && jr.payload?.jobs ? jr.payload.jobs : []);
        const list = sr.ok && sr.payload?.sessions ? (sr.payload.sessions as SessionPreview[]) : [];
        setSessions(list.filter((s) => s.key.startsWith(prefix)).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)));
      })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoadingDetail(false));
  }, [selectedAgentId]);

  const heartbeatMap = agentHeartbeatMap(nodes);
  const selectedAgentLastHeartbeat = selectedAgentId ? heartbeatMap.get(selectedAgentId) : undefined;

  const runCron = useCallback(
    (id: string) => {
      if (!selectedAgentId) return;
      gatewayClient.request("cron.run", { id, agentId: selectedAgentId }).then(() => {
        gatewayClient
          .request<{ jobs: CronJob[] }>("cron.list", { agentId: selectedAgentId, includeDisabled: true })
          .then((res) => res.ok && res.payload?.jobs && setJobs(res.payload.jobs));
      });
    },
    [selectedAgentId]
  );

  return (
    <div className="contacts-panel">
      <div className="contacts-list-column">
        <h2 className="contacts-list-title">Agent 通讯录</h2>
        {loadingList ? (
          <p className="loading">加载中…</p>
        ) : err ? (
          <p className="error">{err}</p>
        ) : nodes.length === 0 ? (
          <p className="empty">暂无节点</p>
        ) : (
          <div className="contacts-list-by-node">
            {nodes.map((node) => (
              <section key={node.nodeId} className="contacts-node-group">
                <h3 className="contacts-node-name">{nodeDisplayName(node)}</h3>
                {(node.agents ?? []).length === 0 ? (
                  <p className="contacts-node-empty">无智能体</p>
                ) : (
                  <ul className="contacts-list">
                    {(node.agents ?? []).map((a) => (
                      <li key={`${node.nodeId}-${a.agentId}`} className="contacts-list-item">
                        <button
                          type="button"
                          className={`contacts-list-btn ${selectedAgentId === a.agentId ? "active" : ""}`}
                          onClick={() => setSelectedAgentId(a.agentId)}
                        >
                          <span className={`contacts-list-dot ${isOnline(a.lastHeartbeatAt) ? "online" : ""}`} title={statusLabel(a.lastHeartbeatAt)} />
                          <span className="contacts-list-label">{a.agentId}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
        )}
      </div>
      <div className="contacts-detail-column">
        {!selectedAgentId ? (
          <div className="contacts-detail-empty">
            <p>点击左侧智能体查看状态、定时任务与历史对话</p>
          </div>
        ) : (
          <>
            <header className="contacts-detail-header">
              <h3 className="contacts-detail-agent">{selectedAgentId}</h3>
              <button type="button" className="contacts-send-btn" onClick={() => onOpenChat(selectedAgentId)}>
                发消息
              </button>
            </header>
            {loadingDetail ? (
              <p className="loading">加载中…</p>
            ) : (
              <div className="contacts-detail-sections">
                <section className="contacts-detail-section">
                  <h4 className="contacts-detail-section-title">状态</h4>
                  <p className="contacts-detail-status">
                    <span className={`contacts-status-badge ${isOnline(selectedAgentLastHeartbeat) ? "online" : ""}`}>
                      {statusLabel(selectedAgentLastHeartbeat)}
                    </span>
                    {selectedAgentLastHeartbeat != null && (
                      <span className="muted"> · 最近心跳 {heartbeatHint(selectedAgentLastHeartbeat)}</span>
                    )}
                  </p>
                </section>
                <section className="contacts-detail-section">
                  <h4 className="contacts-detail-section-title">定时任务</h4>
                  {jobs.length === 0 ? (
                    <p className="empty">暂无定时任务</p>
                  ) : (
                    <ul className="contacts-cron-list">
                      {jobs.map((j) => (
                        <li key={j.id} className="contacts-cron-item">
                          <div>
                            <strong>{j.name ?? j.id}</strong>
                            {j.enabled === false && <span className="badge" style={{ marginLeft: "0.5rem" }}>禁用</span>}
                            <div className="muted" style={{ fontSize: "0.8rem" }}>
                              {j.nextRunAtMs != null ? `下次: ${new Date(j.nextRunAtMs).toLocaleString()}` : "—"}
                            </div>
                          </div>
                          <button type="button" className="run-btn" onClick={() => runCron(j.id)}>
                            立即运行
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
                <section className="contacts-detail-section">
                  <h4 className="contacts-detail-section-title">历史对话</h4>
                  {sessions.length === 0 ? (
                    <p className="empty">暂无历史对话</p>
                  ) : (
                    <ul className="contacts-session-list">
                      {sessions.map((s) => (
                        <li key={s.key} className="contacts-session-item">
                          <button
                            type="button"
                            className="contacts-session-btn"
                            onClick={() => onOpenChat(selectedAgentId, s.key)}
                          >
                            <span className="contacts-session-label">
                              {s.displayName || s.key.replace(new RegExp(`^agent:${selectedAgentId}:`), "") || s.sessionId?.slice(0, 8) || s.key}
                            </span>
                            <span className="contacts-session-meta">
                              {s.updatedAt ? new Date(s.updatedAt).toLocaleString() : ""}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
