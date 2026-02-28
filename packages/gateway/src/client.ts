/**
 * Gateway 客户端：WebSocket 连接，发 request 收 response；支持 callGateway 单次调用。
 */

import type { GatewayRequest, GatewayResponse } from "./protocol.js";

export type CallGatewayOptions = {
	url: string;
	method: string;
	params?: Record<string, unknown>;
	id?: string;
	timeoutMs?: number;
	/** 认证：若 Gateway 要求 token/password，传其一即可；客户端会先发 connect 再发本次请求 */
	token?: string;
	password?: string;
};

/**
 * 单次 RPC：连接 Gateway，若提供 token/password 则先发 connect 再发本次请求，收 response 后关闭。
 */
export async function callGateway<T = unknown>(opts: CallGatewayOptions): Promise<T> {
	const {
		url,
		method,
		params,
		id = `req-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
		timeoutMs = 30_000,
		token,
		password,
	} = opts;
	const wsUrl = url.startsWith("ws") ? url : url.replace(/^http/, "ws").replace(/\/?$/, "");
	const ws = new (await import("ws")).WebSocket(wsUrl);

	const connectId = "conn-" + id;

	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => {
			cleanup();
			reject(new Error(`Gateway request timeout (${timeoutMs}ms)`));
		}, timeoutMs);

		function cleanup() {
			clearTimeout(timer);
			try {
				ws.removeAllListeners();
				if (ws.readyState === 1) ws.close();
			} catch {}
		}

		ws.on("error", (err) => {
			cleanup();
			reject(err);
		});

		let needConnect = Boolean((token ?? password) && (token !== "" || password !== ""));

		ws.on("open", () => {
			if (needConnect) {
				const connectParams: Record<string, unknown> = { ...(params ?? {}) };
				if (token != null) connectParams.token = token;
				if (password != null) connectParams.password = password;
				ws.send(JSON.stringify({ method: "connect", params: connectParams, id: connectId }));
			} else {
				ws.send(JSON.stringify({ method, params, id }));
			}
		});

		ws.on("message", (data: Buffer | ArrayBuffer) => {
			let res: GatewayResponse;
			try {
				const raw = typeof data === "string" ? data : (data as Buffer).toString("utf8");
				res = JSON.parse(raw) as GatewayResponse;
			} catch {
				cleanup();
				reject(new Error("Invalid JSON response from gateway"));
				return;
			}
			const resId = res.id;

			if (needConnect && resId === connectId) {
				if (!res.ok) {
					cleanup();
					reject(new Error(res.error?.message ?? "Gateway auth failed"));
					return;
				}
				needConnect = false;
				ws.send(JSON.stringify({ method, params, id }));
				return;
			}

			if (resId !== undefined && resId !== id) return;
			cleanup();
			if (!res.ok) {
				reject(new Error(res.error?.message ?? "Gateway error"));
				return;
			}
			resolve(res.payload as T);
		});
	});
}
