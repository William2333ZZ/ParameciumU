/**
 * 以 Connector 身份长连 Gateway，用于在 Control UI 中显示为「飞书」节点，并通过同一连接发 connector.message.inbound；
 * 支持接收服务端推送的 connector.message.push 并回调 onPush。
 */
import WebSocket from "ws";
import type { FeishuAppConfig } from "./config.js";

/** Gateway 主动推送的 connector.message.push 的 payload */
export type ConnectorMessagePushPayload = {
	connectorId: string;
	chatId: string;
	channelId?: string;
	text: string;
	attachments?: unknown[];
	replyToId?: string;
};

export type GatewayConnectorClient = {
	request<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
	close(): void;
};

export type GatewayConnectorClientOptions = {
	/** 收到 connector.message.push 时调用（主动回复到 app） */
	onPush?: (payload: ConnectorMessagePushPayload) => void;
};

function getWsUrl(config: FeishuAppConfig): string {
	const u = config.gatewayWsUrl.trim();
	if (u.startsWith("ws")) return u;
	return u.replace(/^http/, "ws").replace(/\/?$/, "");
}

export function createGatewayConnectorClient(
	config: FeishuAppConfig,
	connectorId: string,
	log: (msg: string) => void,
	options?: GatewayConnectorClientOptions,
): Promise<GatewayConnectorClient> {
	const url = getWsUrl(config);
	const onPush = options?.onPush;
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(url);
		const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

		ws.on("error", (err) => {
			log(`[gateway] ws error: ${String(err)}`);
			reject(err);
		});

		ws.on("open", () => {
			const connectId = `conn-${Date.now()}`;
			const params: Record<string, unknown> = { role: "connector", connectorId };
			if (config.connectorDisplayName?.trim()) params.connectorDisplayName = config.connectorDisplayName.trim();
			ws.send(JSON.stringify({ method: "connect", params, id: connectId }));
		});

		ws.on("message", (data: Buffer | ArrayBuffer) => {
			let msg: {
				id?: string;
				ok?: boolean;
				payload?: unknown;
				error?: { message?: string };
				event?: string;
			};
			try {
				const raw = typeof data === "string" ? data : (data as Buffer).toString("utf8");
				msg = JSON.parse(raw) as typeof msg;
			} catch {
				return;
			}
			const id = msg.id;
			if (id !== undefined && pending.has(id)) {
				const { resolve: res, reject: rej } = pending.get(id)!;
				pending.delete(id);
				if (msg.ok === false) {
					rej(new Error(msg.error?.message ?? "Gateway error"));
				} else {
					res(msg.payload);
				}
				return;
			}
			if (msg.event === "connector.message.push" && msg.payload && onPush) {
				const pl = msg.payload as ConnectorMessagePushPayload;
				if (pl.chatId && typeof pl.text === "string") {
					onPush(pl);
				}
			}
		});

		ws.on("close", () => {
			pending.forEach(({ reject }) => reject(new Error("Gateway connection closed")));
			pending.clear();
		});

		const client: GatewayConnectorClient = {
			request<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
				return new Promise((resolve, reject) => {
					const id = `req-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
					if (ws.readyState !== 1) {
						reject(new Error("Gateway not connected"));
						return;
					}
					pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
					ws.send(JSON.stringify({ method, params, id }));
					setTimeout(() => {
						if (pending.delete(id)) reject(new Error("Gateway request timeout"));
					}, 120_000);
				});
			},
			close() {
				ws.removeAllListeners();
				if (ws.readyState === 1) ws.close();
			},
		};

		const onFirstResponse = (data: Buffer | ArrayBuffer) => {
			let msg: { id?: string; ok?: boolean; error?: { message?: string } };
			try {
				const raw = typeof data === "string" ? data : (data as Buffer).toString("utf8");
				msg = JSON.parse(raw) as typeof msg;
			} catch {
				return;
			}
			if (msg.ok === false) {
				reject(new Error(msg.error?.message ?? "Gateway connect failed"));
				return;
			}
			ws.off("message", onFirstResponse);
			log(`[gateway] connected as connector ${connectorId}`);
			resolve(client);
		};

		ws.once("message", onFirstResponse);
	});
}
