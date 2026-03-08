/**
 * Gateway WebSocket 客户端：连接后发 connect（可选 token/password），再发 RPC 请求；支持服务端事件（如 agent.run.chunk）
 */

import type { GatewayRequest, GatewayResponse } from "./types";

export type GatewayClientOptions = {
	url: string;
	token?: string;
	password?: string;
};

export type GatewayEvent = { event: string; payload?: unknown };

type EventCallback = (payload: unknown) => void;

export class GatewayClient {
	private ws: WebSocket | null = null;
	private pending = new Map<string, { resolve: (r: GatewayResponse) => void; reject: (e: Error) => void }>();
	private idSeq = 0;
	private options: GatewayClientOptions | null = null;
	private eventListeners = new Map<string, Set<EventCallback>>();

	async connect(options: GatewayClientOptions): Promise<void> {
		this.options = options;
		const { url, token, password } = options;
		const wsUrl = url.replace(/^http/, "ws");
		return new Promise((resolve, reject) => {
			let resolved = false;
			const done = (err: Error | null) => {
				if (resolved) return;
				resolved = true;
				if (err) reject(err);
				else resolve();
			};
			const ws = new WebSocket(wsUrl);
			ws.onopen = () => {
				this.ws = ws;
				ws.onmessage = (ev) => this.onMessage(ev);
				const connectParams: Record<string, unknown> = { role: "operator" };
				if (token) connectParams.token = token;
				if (password) connectParams.password = password;
				this.request("connect", connectParams)
					.then((res) => {
						if (res.ok) done(null);
						else done(new Error(res.error?.message ?? "connect failed"));
					})
					.catch(done);
			};
			ws.onerror = () => {
				if (!resolved) done(new Error("连接失败：请确认 Gateway 已启动且端口正确（默认 9347）"));
			};
			ws.onclose = (ev) => {
				this.ws = null;
				for (const [, { reject: r }] of this.pending) r(new Error("WebSocket closed"));
				this.pending.clear();
				if (resolved) return;
				const msg =
					ev.code === 1006
						? "无法连接到该地址，请检查 Gateway 是否在运行、端口是否正确（默认 9347）"
						: ev.reason || `连接已关闭 (code ${ev.code})`;
				done(new Error(msg));
			};
		});
	}

	private onMessage(ev: MessageEvent): void {
		let res: GatewayResponse & GatewayEvent;
		try {
			res = JSON.parse(ev.data as string) as GatewayResponse & GatewayEvent;
		} catch {
			return;
		}
		const id = res.id != null ? String(res.id) : null;
		if (id && this.pending.has(id)) {
			const { resolve } = this.pending.get(id)!;
			this.pending.delete(id);
			resolve(res);
		}
		if ("event" in res && typeof res.event === "string") {
			const cbs = this.eventListeners.get(res.event);
			if (cbs) for (const cb of cbs) cb(res.payload);
			const allCbs = this.eventListeners.get("*");
			if (allCbs) for (const cb of allCbs) cb({ event: res.event, payload: res.payload });
		}
	}

	/** 订阅服务端推送事件（如 agent.run.chunk、agent.run.done） */
	onEvent(event: string, callback: EventCallback): () => void {
		if (!this.eventListeners.has(event)) this.eventListeners.set(event, new Set());
		this.eventListeners.get(event)!.add(callback);
		return () => this.eventListeners.get(event)?.delete(callback);
	}

	request<T = unknown>(method: string, params?: Record<string, unknown>): Promise<GatewayResponse & { payload?: T }> {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
			return Promise.reject(new Error("Not connected"));
		}
		const id = `req-${++this.idSeq}-${Date.now()}`;
		const req: GatewayRequest = { method, params, id };
		return new Promise((resolve, reject) => {
			this.pending.set(id, {
				resolve: resolve as (r: GatewayResponse) => void,
				reject,
			});
			this.ws!.send(JSON.stringify(req));
		});
	}

	disconnect(): void {
		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}
		this.options = null;
	}

	isConnected(): boolean {
		return this.ws != null && this.ws.readyState === WebSocket.OPEN;
	}

	getOptions(): GatewayClientOptions | null {
		return this.options;
	}
}

export const gatewayClient = new GatewayClient();
