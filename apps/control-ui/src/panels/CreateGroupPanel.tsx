import { useState, useEffect, useCallback } from "react";
import { gatewayClient } from "../gateway-client";
import type { NodeItem } from "../types";

type NodeListPayload = { nodes?: NodeItem[] };

/** 从 nodes 汇总去重后的 agentId 列表（与通讯录一致） */
function collectAgentIds(nodes: NodeItem[]): string[] {
  const set = new Set<string>();
  for (const n of nodes) {
    for (const a of n.agents ?? []) set.add(a.agentId);
  }
  return Array.from(set).sort();
}

type Props = {
  onCreated: (leadAgentId: string, sessionKey: string) => void;
  onCancel: () => void;
};

export function CreateGroupPanel({ onCreated, onCancel }: Props) {
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [groupName, setGroupName] = useState("");
  const [creating, setCreating] = useState(false);

  const loadNodes = useCallback(() => {
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

  useEffect(() => {
    loadNodes();
  }, [loadNodes]);

  const agentIds = collectAgentIds(nodes);

  const toggle = (agentId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  };

  const createGroup = () => {
    const list = Array.from(selectedIds);
    if (list.length === 0) return;
    setCreating(true);
    const leadAgentId = list[0]!;
    const sessionKey = `agent:${leadAgentId}:group-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const patch = {
      sessionType: "group" as const,
      participantAgentIds: list,
      leadAgentId: list[0],
      displayName: groupName.trim() || "群聊",
    };
    gatewayClient
      .request("sessions.patch", { sessionKey, patch })
      .then((res) => {
        if (res.ok) {
          onCreated(leadAgentId, sessionKey);
        } else {
          setErr((res as { error?: { message?: string } }).error?.message ?? "创建群聊失败");
        }
      })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setCreating(false));
  };

  if (loading) {
    return (
      <div className="create-group-panel">
        <p className="loading">加载成员列表…</p>
      </div>
    );
  }

  if (err) {
    return (
      <div className="create-group-panel">
        <p className="error">{err}</p>
        <button type="button" className="chat-refresh-btn" onClick={loadNodes}>
          重试
        </button>
      </div>
    );
  }

  return (
    <div className="create-group-panel">
      <header className="create-group-header">
        <button type="button" className="create-group-back" onClick={onCancel} aria-label="返回">
          ←
        </button>
        <h2 className="create-group-title">选择群成员</h2>
      </header>
      <div className="create-group-body">
        <div className="create-group-field">
          <label className="create-group-label">群名称（可选）</label>
          <input
            type="text"
            className="create-group-input"
            placeholder="未填写则显示为「群聊」"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
          />
        </div>
        <p className="create-group-hint">选择要加入群聊的智能体，至少选择 1 个</p>
        <ul className="create-group-list">
          {agentIds.map((agentId) => (
            <li key={agentId} className="create-group-list-item">
              <label className="create-group-check-label">
                <input
                  type="checkbox"
                  checked={selectedIds.has(agentId)}
                  onChange={() => toggle(agentId)}
                  className="create-group-checkbox"
                />
                <span className="create-group-agent-id">{agentId}</span>
              </label>
            </li>
          ))}
        </ul>
      </div>
      <footer className="create-group-footer">
        <button type="button" className="create-group-btn create-group-btn-secondary" onClick={onCancel}>
          取消
        </button>
        <button
          type="button"
          className="create-group-btn create-group-btn-primary"
          disabled={selectedIds.size === 0 || creating}
          onClick={createGroup}
        >
          {creating ? "创建中…" : `完成（${selectedIds.size} 人）`}
        </button>
      </footer>
    </div>
  );
}
