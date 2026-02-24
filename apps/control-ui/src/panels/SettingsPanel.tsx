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
    </div>
  );
}
