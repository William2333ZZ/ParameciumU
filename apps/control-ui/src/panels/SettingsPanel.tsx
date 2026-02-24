import { useState, useEffect } from "react";
import { gatewayClient } from "../gateway-client";

type Props = {
  onDisconnect: () => void;
};

const STORAGE_KEY_URL = "monou_control_ui_gateway_url";
const STORAGE_KEY_TOKEN = "monou_control_ui_token";

export function getStoredConnection(): { url: string; token: string } {
  if (typeof localStorage === "undefined") return { url: "", token: "" };
  return {
    url: localStorage.getItem(STORAGE_KEY_URL) ?? "",
    token: localStorage.getItem(STORAGE_KEY_TOKEN) ?? "",
  };
}

export function setStoredConnection(url: string, token: string): void {
  if (typeof localStorage === "undefined") return;
  if (url) localStorage.setItem(STORAGE_KEY_URL, url);
  else localStorage.removeItem(STORAGE_KEY_URL);
  if (token) localStorage.setItem(STORAGE_KEY_TOKEN, token);
  else localStorage.removeItem(STORAGE_KEY_TOKEN);
}

/** 去掉 payload 里的 cron 字段（cron 属于各 Agent，不属于 Gateway，避免误导）。 */
function stripCron(obj: unknown): unknown {
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    const next = { ...(obj as Record<string, unknown>) };
    delete next.cron;
    return next;
  }
  return obj;
}

/** 设置页内「调试信息」折叠区：展示 health/status 原始 JSON，便于排查问题。Gateway 为无状态路由；cron 属于 Agent 不展示。 */
function DebugInfoBlock() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ health?: unknown; status?: unknown } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    Promise.all([
      gatewayClient.request("health").then((r) => r.ok && r.payload ? stripCron(r.payload) : null),
      gatewayClient.request("status").then((r) => r.ok && r.payload ? stripCron(r.payload) : null),
    ])
      .then(([health, status]) => setData({ health, status }))
      .catch((e) => setErr((e as Error).message));
  }, [open]);

  return (
    <div className="settings-debug-block" style={{ marginTop: "1rem" }}>
      <button
        type="button"
        className="nav-item"
        style={{ fontSize: "0.9rem", marginBottom: "0.5rem" }}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        {open ? "▼" : "▶"} 调试信息（health / status，不含 cron）
      </button>
      {open && (
        <div className="card" style={{ padding: "0.75rem", fontSize: "0.8rem" }}>
          {err && <p className="error">{err}</p>}
          {data && (
            <pre style={{ margin: 0, overflow: "auto", maxHeight: "20rem", whiteSpace: "pre-wrap" }}>
              {JSON.stringify(data, null, 2)}
            </pre>
          )}
          {open && !data && !err && <p className="muted">加载中…</p>}
        </div>
      )}
    </div>
  );
}

export function SettingsPanel({ onDisconnect }: Props) {
  const opts = gatewayClient.getOptions();
  const stored = getStoredConnection();

  return (
    <div className="card">
      <h3>连接设置</h3>
      <p className="muted" style={{ fontSize: "0.85rem", marginBottom: "0.75rem" }}>
        Token 已保存在本地，仅用于自动填充
      </p>
      <dl className="settings-dl">
        <dt>当前 Gateway</dt>
        <dd>{opts?.url || "—"}</dd>
        <dt>已保存 URL</dt>
        <dd className="muted">{stored.url || "—"}</dd>
        <dt>Token</dt>
        <dd className="muted">{stored.token ? "••••••••" : "—"}</dd>
      </dl>
      <button type="button" className="disconnect-btn settings-disconnect" onClick={onDisconnect}>
        断开连接
      </button>
      <DebugInfoBlock />
    </div>
  );
}
