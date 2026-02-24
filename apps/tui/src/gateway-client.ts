/**
 * Gateway 客户端：从环境变量读 URL，封装 RPC call（与 OpenClaw 用法类似）
 */
import { callGateway } from "@monou/gateway";

/** 与 .env 中 GATEWAY_WS_URL 常用配置一致 */
const DEFAULT_URL = "ws://127.0.0.1:9347";

export function getGatewayUrl(): string {
  const u = process.env.GATEWAY_WS_URL?.trim() || process.env.GATEWAY_URL?.trim();
  return u && u.length > 0 ? u : DEFAULT_URL;
}

export type GatewayClient = {
  url: string;
  call: <T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs?: number,
  ) => Promise<T>;
};

export function createGatewayClient(): GatewayClient {
  const url = getGatewayUrl();
  const token = process.env.GATEWAY_TOKEN?.trim();
  const password = process.env.GATEWAY_PASSWORD?.trim();

  return {
    url,
    call: async <T = unknown>(
      method: string,
      params?: Record<string, unknown>,
      timeoutMs = 30_000,
    ): Promise<T> => {
      const opts: Parameters<typeof callGateway>[0] = { url, method, timeoutMs };
      if (params) opts.params = params;
      if (token) opts.token = token;
      if (password) opts.password = password;
      return callGateway(opts) as Promise<T>;
    },
  };
}
