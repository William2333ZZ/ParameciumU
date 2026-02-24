/**
 * 可选 TLS：从环境变量读取证书路径，创建 https.Server 供 WebSocket 挂载。
 */

import { readFileSync } from "node:fs";
import https from "node:https";

export type TlsConfig = {
  certPath: string;
  keyPath: string;
};

/**
 * 从环境变量解析 TLS 配置。
 * GATEWAY_TLS_CERT、GATEWAY_TLS_KEY 均为非空时返回配置，否则返回 null。
 */
export function resolveTlsConfig(): TlsConfig | null {
  const certPath = process.env.GATEWAY_TLS_CERT?.trim();
  const keyPath = process.env.GATEWAY_TLS_KEY?.trim();
  if (!certPath || !keyPath) return null;
  return { certPath, keyPath };
}

/**
 * 创建 https.Server；证书与私钥从文件同步读取。
 */
export function createHttpsServer(config: TlsConfig): import("node:https").Server {
  const cert = readFileSync(config.certPath, "utf8");
  const key = readFileSync(config.keyPath, "utf8");
  return https.createServer({ cert, key }, (_req, res) => {
    res.writeHead(404);
    res.end("Not Found");
  });
}
