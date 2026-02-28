import { useState, useEffect, useCallback } from "react";
import { gatewayClient } from "../gateway-client";
import type { CronJob } from "../types";

type AgentItem = { agentId: string; deviceId?: string; connId: string; online: boolean };

/** Cron 属于单个 Agent（该 Agent 目录下的 cron/jobs.json）。Gateway 按 agentId 读写对应路径。 */
export function CronPanel() {
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const loadAgents = useCallback(() => {
    gatewayClient
      .request<{ agents: AgentItem[] }>("agents.list")
      .then((res) => {
        if (res.ok && res.payload?.agents) {
          const list = res.payload.agents;
          setAgents(list);
          setSelectedAgentId((prev) => {
            if (!prev || !list.some((a) => a.agentId === prev)) return list[0]?.agentId ?? "";
            return prev;
          });
        } else setAgents([]);
      })
      .catch(() => setAgents([]));
  }, []);

  const loadJobs = useCallback(() => {
    if (!selectedAgentId) {
      setJobs([]);
      setLoading(false);
      return;
    }
    setErr(null);
    setLoading(true);
    gatewayClient
      .request<{ jobs: CronJob[] }>("cron.list", { agentId: selectedAgentId, includeDisabled: true })
      .then((res) => {
        if (res.ok && res.payload) setJobs(res.payload.jobs ?? []);
      })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  }, [selectedAgentId]);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  const run = async (id: string) => {
    const res = await gatewayClient.request("cron.run", { id, agentId: selectedAgentId });
    if (res.ok) loadJobs();
  };

  return (
    <div className="card">
      <h3>定时任务（Cron）</h3>
      <p className="muted" style={{ fontSize: "0.85rem", marginBottom: "0.75rem" }}>
        Cron 属于单个 Agent，存储在该 Agent 目录下的 <code>cron/jobs.json</code>。请先选择 Agent。
      </p>

      <div className="cron-agent-selector" style={{ marginBottom: "1rem" }}>
        <label style={{ fontSize: "0.9rem", marginRight: "0.5rem" }}>Agent</label>
        <select
          value={selectedAgentId}
          onChange={(e) => setSelectedAgentId(e.target.value)}
          style={{ padding: "0.35rem 0.6rem", fontSize: "0.9rem", minWidth: "140px" }}
        >
          {agents.length === 0 && (
            <option value="">请先连接 Agent</option>
          )}
          {agents.map((a) => (
            <option key={a.agentId} value={a.agentId}>
              {a.agentId}
            </option>
          ))}
        </select>
      </div>

      <p className="muted" style={{ fontSize: "0.8rem", marginBottom: "0.5rem" }}>
        以下为 <strong>{selectedAgentId || "—"}</strong> 的定时任务（{selectedAgentId ? `agents/${selectedAgentId}/cron/jobs.json` : "请先选择 Agent"}）。
      </p>
      {loading && <p className="loading">加载中…</p>}
      {err && <p className="error">加载失败: {err}</p>}
      {!loading && !err && jobs.length === 0 && <p className="empty">暂无定时任务</p>}
      {!loading && !err && jobs.length > 0 &&
        jobs.map((j) => (
          <div key={j.id} className="cron-row">
            <div>
              <strong>{j.name ?? j.id}</strong>
              {j.enabled === false && <span className="badge" style={{ marginLeft: "0.5rem" }}>禁用</span>}
              <div className="muted" style={{ fontSize: "0.8rem" }}>
                nextRunAt: {j.nextRunAtMs != null ? new Date(j.nextRunAtMs).toISOString() : "-"}
              </div>
            </div>
            <button type="button" className="run-btn" onClick={() => run(j.id)}>
              立即运行
            </button>
          </div>
        ))}
    </div>
  );
}
