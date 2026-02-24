import { useState, useEffect } from "react";
import { gatewayClient } from "../gateway-client";
import type { CronJob } from "../types";

export function CronPanel() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = () => {
    setErr(null);
    gatewayClient
      .request<{ jobs: CronJob[] }>("cron.list", { includeDisabled: true })
      .then((res) => {
        if (res.ok && res.payload) setJobs(res.payload.jobs ?? []);
      })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const run = async (id: string) => {
    const res = await gatewayClient.request("cron.run", { id });
    if (res.ok) load();
  };

  if (loading) return <p className="loading">加载中…</p>;
  if (err) return <p className="error">加载失败: {err}</p>;

  return (
    <div className="card">
      <h3>Cron 任务</h3>
      <p className="muted" style={{ fontSize: "0.85rem", marginBottom: "0.5rem" }}>
        当前为 Gateway 本机 .u 的定时任务；多 Agent 时各 Agent 目录有独立 cron，此处仅本机。
      </p>
      {jobs.length === 0 ? (
        <p className="empty">暂无定时任务</p>
      ) : (
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
        ))
      )}
    </div>
  );
}
