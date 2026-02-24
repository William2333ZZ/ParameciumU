/**
 * WebSocket 服务：首条可为 connect(身份)，可选认证；支持 node.invoke 转发。
 */

import type { WebSocket } from "ws";
import { WebSocketServer } from "ws";
import type { GatewayRequest, GatewayResponse, GatewayEvent } from "@monou/gateway";
import { GATEWAY_METHODS } from "@monou/gateway";
import type { GatewayHandlers } from "./handlers.js";
import type { GatewayContext, ConnectionEntry } from "./context.js";
import type { AuthConfig } from "./auth.js";
import { isAuthRequired, verifyConnect } from "./auth.js";

const METHOD_SET = new Set<string>(GATEWAY_METHODS);
const CONNECT_METHOD = "connect";
const UNAUTHORIZED = 401;

export type GatewayWsServerOptions = {
  /** 无 server 时必填 */
  port?: number;
  host?: string;
  context: GatewayContext;
  handlers: GatewayHandlers;
  auth?: AuthConfig;
  /** 若提供，则使用该 server（如 https）挂 WebSocket，此时 port/host 由调用方 listen 时指定 */
  server?: import("node:http").Server | import("node:https").Server;
  onListen?: (port: number, host: string) => void;
};

export function createGatewayWsServer(opts: GatewayWsServerOptions): WebSocketServer {
  const { context, handlers, auth = {} } = opts;
  const authRequired = isAuthRequired(auth);

  const wss = opts.server
    ? new WebSocketServer({ server: opts.server })
    : new WebSocketServer({ port: opts.port ?? 9347, host: opts.host ?? "127.0.0.1" });

  if (!opts.server) {
    wss.on("listening", () => {
      const addr = wss.address();
      if (addr && typeof addr === "object") opts.onListen?.(addr.port, addr.address);
    });
  }

  wss.on("connection", (ws: WebSocket) => {
    const connId = context.nextConnId();
    const entry: ConnectionEntry = { connId, ws, connectedAt: Date.now() };
    context.connections.set(connId, entry);

    ws.on("close", () => {
      const identity = context.connections.get(connId)?.identity;
      if (identity?.role === "agent") {
        console.error(`[gateway] agent disconnected: agentId=${identity.agentId} connId=${connId}`);
      }
      context.connections.delete(connId);
    });

    ws.on("message", (data: Buffer | ArrayBuffer) => {
      let req: GatewayRequest;
      try {
        const raw = typeof data === "string" ? data : (data as Buffer).toString("utf8");
        req = JSON.parse(raw) as GatewayRequest;
      } catch {
        send(ws, { ok: false, error: { code: 400, message: "Invalid JSON" } });
        return;
      }
      const { method, params, id } = req;
      if (!method) {
        send(ws, { id, ok: false, error: { code: 400, message: "Missing method" } });
        return;
      }

      if (method === CONNECT_METHOD && params && typeof params === "object") {
        if (authRequired) {
          const result = verifyConnect(auth, params as Record<string, unknown>);
          if (!result.ok) {
            send(ws, { id, ok: false, error: { code: UNAUTHORIZED, message: result.reason ?? "Auth required" } });
            ws.close();
            return;
          }
        }
        entry.authenticated = true;
        entry.identity = params as ConnectionEntry["identity"];
        const sessionKey = (params as Record<string, unknown>).sessionKey;
        if (typeof sessionKey === "string" && sessionKey.trim()) entry.sessionKey = sessionKey.trim();
        if (entry.identity?.role === "agent") {
          console.error(`[gateway] agent connected: agentId=${entry.identity.agentId} deviceId=${entry.identity.deviceId} connId=${connId}`);
        }
        if (entry.identity?.role === "connector" && entry.identity?.connectorId) {
          console.error(`[gateway] connector connected: connectorId=${entry.identity.connectorId} connId=${connId}`);
        }
        send(ws, { id, ok: true, payload: { ok: true, message: "connected" } });
        return;
      }

      if (authRequired && !entry.authenticated) {
        send(ws, { id, ok: false, error: { code: UNAUTHORIZED, message: "Send connect with token/password first" } });
        ws.close();
        return;
      }

      if (!METHOD_SET.has(method)) {
        send(ws, { id, ok: false, error: { code: 400, message: `Unknown method: ${method}` } });
        return;
      }
      const handler = (handlers as Record<string, (p: Record<string, unknown>, req?: { connId: string; entry: ConnectionEntry }) => Promise<GatewayResponse>>)[method];
      if (!handler) {
        send(ws, { id, ok: false, error: { code: 500, message: "Handler missing" } });
        return;
      }
      const reqCtx = { connId, entry };
      handler(params ?? {}, reqCtx).then((res) => send(ws, { ...res, id })).catch((e) => {
        send(ws, { id, ok: false, error: { code: 500, message: (e as Error).message } });
      });
    });
  });

  return wss;
}

function send(ws: WebSocket, msg: GatewayResponse): void {
  if (ws.readyState !== 1) return;
  ws.send(JSON.stringify(msg));
}

export function broadcastEvent(wss: WebSocketServer, event: GatewayEvent): void {
  const payload = JSON.stringify(event);
  wss.clients.forEach((client: WebSocket) => {
    if (client.readyState === 1) client.send(payload);
  });
}

/** 仅向 identity.role === "connector" 且 identity.connectorId === connectorId 的连接推送事件 */
export function pushToConnector(
  context: GatewayContext,
  connectorId: string,
  event: string,
  payload: unknown,
): void {
  const frame = JSON.stringify({ event, payload });
  for (const [, entry] of context.connections) {
    if (
      entry.identity?.role === "connector" &&
      entry.identity.connectorId === connectorId &&
      entry.ws.readyState === 1
    ) {
      try {
        entry.ws.send(frame);
      } catch {
        // ignore send errors
      }
    }
  }
}
