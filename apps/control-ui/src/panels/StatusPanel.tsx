import { useState, useEffect } from "react";
import { gatewayClient } from "../gateway-client";

type StatusPayload = {
  ok?: boolean;
  ts?: number;
  cron?: { storePath?: string; jobs?: number };
  agents?: number;
  nodes?: number;
};

export function StatusPanel() {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    gatewayClient
      .request<StatusPayload>("status")
      .then((res) => {
        if (res.ok && res.payload) setStatus(res.payload);
      })
      .catch((e) => setErr((e as Error).message));
  }, []);

  if (err) return <p className="error">加载失败: {err}</p>;
  if (!status) return <p className="loading">加载中…</p>;

  return (
    <div className="card">
      <h3>Gateway 状态</h3>
      <pre style={{ margin: 0, fontSize: "0.85rem", overflow: "auto" }}>
        {JSON.stringify(status, null, 2)}
      </pre>
    </div>
  );
}
