import { useState, useCallback, useEffect } from "react";
import { gatewayClient } from "./gateway-client";
import { ConnectForm } from "./ConnectForm";
import { MainView } from "./MainView";
import { getStoredConnection, setStoredConnection } from "./panels/SettingsPanel";

function getInitialUrlAndToken(): { url: string; token: string } {
  if (typeof window === "undefined") return { url: "", token: "" };
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get("gatewayUrl")?.trim();
  const fromToken = params.get("token")?.trim();
  if (fromUrl) {
    if (window === window.top && typeof fromToken === "string") {
      try {
        const u = new URL(window.location.href);
        u.searchParams.delete("gatewayUrl");
        u.searchParams.delete("token");
        window.history.replaceState(null, "", u.toString());
      } catch {}
    }
    return { url: fromUrl, token: fromToken ?? "" };
  }
  return getStoredConnection();
}

export default function App() {
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initial, setInitial] = useState<{ url: string; token: string }>(() => ({ url: "", token: "" }));

  useEffect(() => {
    setInitial(getInitialUrlAndToken());
  }, []);

  const handleConnect = useCallback(
    async (url: string, token?: string, password?: string) => {
      setError(null);
      try {
        await gatewayClient.connect({ url, token, password });
        setStoredConnection(url, token ?? "");
        setConnected(true);
      } catch (e) {
        const msg = (e as Error).message;
        if (msg === "invalid request frame" || msg.includes("invalid request frame")) {
          setError(
            "该地址返回了 invalid request frame，通常表示当前是 OpenClaw Gateway 或其它协议。请确认 18790 上运行的是 monoU Gateway：在 monoU 根目录执行 GATEWAY_PORT=18790 npm run gateway（或 GATEWAY_HOST=0.0.0.0 GATEWAY_PORT=18790 node apps/gateway/dist/index.js）。"
          );
        } else {
          setError(msg);
        }
      }
    },
    []
  );

  const handleDisconnect = useCallback(() => {
    gatewayClient.disconnect();
    setConnected(false);
    setError(null);
  }, []);

  if (!connected) {
    return (
      <div className="app">
        <ConnectForm
          onSubmit={handleConnect}
          error={error}
          initialUrl={initial.url}
          initialToken={initial.token}
        />
      </div>
    );
  }

  return <MainView onDisconnect={handleDisconnect} />;
}
