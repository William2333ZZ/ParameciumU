import { useState, FormEvent, useEffect } from "react";

type Props = {
  onSubmit: (url: string, token?: string, password?: string) => void;
  error: string | null;
  initialUrl?: string;
  initialToken?: string;
};

export function ConnectForm({ onSubmit, error, initialUrl = "", initialToken = "" }: Props) {
  const [url, setUrl] = useState(() => {
    if (initialUrl) return initialUrl;
    return typeof location !== "undefined" && location.hostname === "localhost"
      ? "ws://127.0.0.1:9347"
      : "";
  });
  const [token, setToken] = useState(initialToken);
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (initialUrl) setUrl(initialUrl);
    if (initialToken) setToken(initialToken);
  }, [initialUrl, initialToken]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const u = url.trim();
    if (!u) return;
    onSubmit(u, token.trim() || undefined, password.trim() || undefined);
  };

  return (
    <div className="connect-wrap">
      <h1>ParameciumU Control UI</h1>
      <p className="muted">连接 Gateway 后管理节点、Agent、Cron 与对话</p>
      <form onSubmit={handleSubmit} className="connect-form">
        <label>
          Gateway URL (ws 或 wss)
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="ws://127.0.0.1:9347"
            autoComplete="off"
          />
          <span className="muted" style={{ fontSize: "0.75rem", marginTop: "0.25rem" }}>
            默认端口 <strong>9347</strong>，请先启动 Gateway：<code>npm run gateway</code>
          </span>
        </label>
        <label>
          Token（可选）
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder=""
            autoComplete="off"
          />
        </label>
        <label>
          Password（可选）
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder=""
            autoComplete="off"
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit">连接</button>
      </form>
    </div>
  );
}
