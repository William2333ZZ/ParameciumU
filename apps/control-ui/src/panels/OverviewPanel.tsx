import { useState, useEffect } from "react";
import { gatewayClient } from "../gateway-client";
import type { NodeItem, ConnectorItem } from "../types";

const LOCAL_DEVICE_IDS = ["1270000001", "local"];

function nodeDisplayName(n: NodeItem): string {
  if (n.deviceId && LOCAL_DEVICE_IDS.includes(n.deviceId)) return "本机";
  return n.nodeId;
}

/** 根据 lastHeartbeatAt 显示「最近活跃」或「未上报心跳」 */
function AgentHeartbeatHint({ lastHeartbeatAt }: { lastHeartbeatAt?: number }) {
  if (lastHeartbeatAt == null) {
    return <span className="muted" style={{ fontSize: "0.75rem" }}>未上报心跳</span>;
  }
  const sec = Math.floor((Date.now() - lastHeartbeatAt) / 1000);
  const label = sec < 60 ? "刚刚" : sec < 3600 ? `${Math.floor(sec / 60)} 分钟前` : sec < 86400 ? `${Math.floor(sec / 3600)} 小时前` : `${Math.floor(sec / 86400)} 天前`;
  return <span className="muted" style={{ fontSize: "0.75rem" }}>最近活跃 {label}</span>;
}

type NodeListPayload = {
  nodes?: NodeItem[];
  connectors?: ConnectorItem[];
};

type StatusPayload = {
  ok?: boolean;
  ts?: number;
  cron?: { storePath?: string; jobs?: number };
  agents?: number;
  nodes?: number;
};

type Props = {
  onOpenChat: (agentId: string, sessionKey?: string) => void;
  /** 仅用于「节点」tab：只显示节点列表区块，不显示全景说明 */
  showNodesOnly?: boolean;
};

/**
 * 展示逻辑（与 Gateway 一致）：
 * - Gateway 是中心，只有一个。
 * - 节点 (Node) = 按 deviceId 聚合的连接，每个设备一个节点，挂在 Gateway 下。
 * - 每个节点下有零个或多个 Agent（agents.list 按 deviceId 聚合到 node.agents）。
 * - 本机未连 agent 时 Gateway 会补一条「本机」节点（deviceId 1270000001），其上有默认 Agent .u。
 */
export function OverviewPanel({ onOpenChat, showNodesOnly }: Props) {
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [connectors, setConnectors] = useState<ConnectorItem[]>([]);
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    Promise.all([
      gatewayClient.request<NodeListPayload>("node.list"),
      gatewayClient.request<StatusPayload>("status"),
    ])
      .then(([nr, sr]) => {
        if (cancelled) return;
        const payload = nr.ok && nr.payload ? (nr.payload as NodeListPayload) : {};
        const list = Array.isArray(payload.nodes) ? payload.nodes : [];
        const connList = Array.isArray(payload.connectors) ? payload.connectors : [];
        setNodes(list);
        setConnectors(connList);
        if (sr.ok && sr.payload) setStatus(sr.payload);
      })
      .catch((e) => {
        if (!cancelled) setErr((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <p className="loading">加载中…</p>;
  if (err) return <p className="error">加载失败: {err}</p>;

  const totalAgents = nodes.reduce((s, n) => s + (n.agents?.length ?? 0), 0);

  return (
    <div className="overview-panel">
      {!showNodesOnly && (
        <>
          <div className="card overview-gateway-root">
            <h3>Gateway 全景</h3>
            <p className="overview-desc">
              Gateway 是中心，下方为已连接的节点；每个节点上可运行多个 Agent。节点由「连接」产生：本机或远程启动 agent-client 连上 Gateway 后即出现；远程需 Node.js 环境。在「节点图」Tab 可查看全景与添加说明。
            </p>
            <div className="gateway-stats">
              <span className="stat">
                <strong>{status?.agents ?? totalAgents}</strong> Agent
              </span>
              <span className="stat">
                <strong>{nodes.length}</strong> 节点
              </span>
              <span className="stat">
                <strong>{connectors.length}</strong> 接入
              </span>
              <span className="stat muted">
                Cron: {status?.cron?.jobs ?? 0}
              </span>
            </div>
          </div>
        </>
      )}

      <div className="card overview-nodes">
        {!showNodesOnly && (
          <>
            <h3 className="overview-nodes-title">节点与 Agent</h3>
            <p className="muted" style={{ fontSize: "0.85rem", marginBottom: "0.5rem" }}>
              Gateway → 节点 → Agent；点击「对话」与该 Agent 聊天
            </p>
          </>
        )}
        {nodes.length === 0 && connectors.length === 0 ? (
          <p className="empty">暂无节点（启动 Gateway 并连接 Agent 或飞书等接入后可见）</p>
        ) : (
          <>
            {connectors.length > 0 && (
              <>
                <h4 className="overview-subtitle" style={{ marginTop: 0 }}>接入 (Connectors)</h4>
                <ul className="overview-node-tree">
                  {connectors.map((c) => (
                    <li key={c.connectorId} className="overview-node-item">
                      <div className="overview-node-row">
                        <span className="overview-node-name">{c.displayName ?? c.connectorId}</span>
                        {c.online && <span className="muted" style={{ fontSize: "0.8rem" }}>已连接</span>}
                      </div>
                    </li>
                  ))}
                </ul>
                <h4 className="overview-subtitle">节点与 Agent</h4>
              </>
            )}
            {nodes.length === 0 ? (
              <p className="empty">暂无节点（启动 agent-client 连上 Gateway 后可见）</p>
            ) : (
              <ul className="overview-node-tree">
                {nodes.map((n) => (
                  <li key={n.nodeId} className="overview-node-item">
                    <div className="overview-node-row">
                      <span className="overview-node-name">{nodeDisplayName(n)}</span>
                      {n.deviceId && !LOCAL_DEVICE_IDS.includes(n.deviceId) && (
                        <span className="muted" style={{ fontSize: "0.8rem" }}>{n.deviceId}</span>
                      )}
                    </div>
                    <ul className="overview-agent-list">
                      {(n.agents ?? []).length === 0 ? (
                        <li className="muted" style={{ fontSize: "0.85rem" }}>— 无 Agent</li>
                      ) : (
                        (n.agents ?? []).map((a) => (
                          <li key={a.agentId} className="overview-agent-row">
                            <span className="overview-agent-id">{a.agentId}</span>
                            <AgentHeartbeatHint lastHeartbeatAt={a.lastHeartbeatAt} />
                            <button
                              type="button"
                              className="chat-link-btn"
                              onClick={() => onOpenChat(a.agentId)}
                            >
                              对话
                            </button>
                          </li>
                        ))
                      )}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
