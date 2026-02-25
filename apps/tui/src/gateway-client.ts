/**
 * Gateway 客户端：支持从环境变量或连接屏传入 URL/Token/Password，封装 RPC call
 */
import { callGateway } from "@monou/gateway";

/** 与 .env 中 GATEWAY_WS_URL 常用配置一致 */
const DEFAULT_URL = "ws://127.0.0.1:9347";

export function getDefaultGatewayUrl(): string {
  const u = process.env.GATEWAY_WS_URL?.trim() || process.env.GATEWAY_URL?.trim();
  return u && u.length > 0 ? u : DEFAULT_URL;
}

export type GatewayConnectionOptions = {
  url: string;
  token?: string;
  password?: string;
};

export type GatewayClient = {
  url: string;
  options: GatewayConnectionOptions;
  call: <T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs?: number,
  ) => Promise<T>;
};

export function createGatewayClient(options?: GatewayConnectionOptions): GatewayClient {
  const url = options?.url?.trim() || getDefaultGatewayUrl();
  const token = options?.token?.trim() || process.env.GATEWAY_TOKEN?.trim();
  const password = options?.password?.trim() || process.env.GATEWAY_PASSWORD?.trim();

  const conn: GatewayConnectionOptions = { url, token: token || undefined, password: password || undefined };

  return {
    url,
    options: conn,
    call: async <T = unknown>(
      method: string,
      params?: Record<string, unknown>,
      timeoutMs = 30_000,
    ): Promise<T> => {
      const opts: Parameters<typeof callGateway>[0] = { ...conn, url: conn.url, method, timeoutMs };
      if (params) opts.params = params;
      if (conn.token) opts.token = conn.token;
      if (conn.password) opts.password = conn.password;
      return callGateway(opts) as Promise<T>;
    },
  };
}
