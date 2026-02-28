/**
 * 连接 Gateway 配置屏 — 与 Web ConnectForm 对齐：URL、Token、Password，Enter 连接
 */

import type { Component, TUI } from "@monou/tui";
import { Container, Input, Text, truncateToWidth } from "@monou/tui";
import type { GatewayConnectionOptions } from "./gateway-client.js";
import { getDefaultGatewayUrl } from "./gateway-client.js";
import { theme } from "./theme.js";

const TITLE = "monoU TUI";
const SUBTITLE = "连接 Gateway 后管理对话、拓扑、会话、Cron（与 Control UI 同源）";
const PROMPTS = ["Gateway URL (ws 或 wss)", "Token（可选，直接 Enter 跳过）", "Password（可选，直接 Enter 跳过）"];
const FOOTER = "Enter 下一步/连接  Esc 取消";

export type ConnectScreenCallbacks = {
	onConnect: (options: GatewayConnectionOptions) => void;
	onCancel: () => void;
};

export class ConnectScreen extends Container implements Component {
	private tui: TUI;
	private step = 0;
	private url = "";
	private token = "";
	private password = "";
	private error = "";
	private connecting = false;
	private input: Input;
	private callbacks: ConnectScreenCallbacks;

	constructor(tui: TUI, callbacks: ConnectScreenCallbacks) {
		super();
		this.tui = tui;
		this.callbacks = callbacks;
		this.url = getDefaultGatewayUrl();
		this.input = new Input();
		this.input.setValue(this.url);
		this.input.onSubmit = (value: string) => this.handleSubmit(value);
		this.input.onEscape = () => callbacks.onCancel();
	}

	private valueForStep(i: number): string {
		if (i === 0) return this.url;
		if (i === 1) return this.token;
		return this.password;
	}

	private handleSubmit(value: string): void {
		const v = value.trim();
		if (this.step === 0) {
			this.url = v || getDefaultGatewayUrl();
			this.step = 1;
			this.input.setValue(this.token);
		} else if (this.step === 1) {
			this.token = v;
			this.step = 2;
			this.input.setValue(this.password);
		} else {
			this.password = v;
			this.doConnect();
			return;
		}
		this.error = "";
		this.tui.requestRender();
	}

	private async doConnect(): Promise<void> {
		this.error = "";
		this.connecting = true;
		this.tui.requestRender();

		const url = (this.url || getDefaultGatewayUrl()).trim();
		const wsUrl = url.startsWith("ws") ? url : url.replace(/^http/, "ws").replace(/\/?$/, "");

		try {
			const { callGateway } = await import("@monou/gateway");
			await callGateway({
				url: wsUrl,
				method: "connect",
				params: {
					role: "operator",
					deviceId: "tui-" + process.pid,
					...(this.token && { token: this.token }),
					...(this.password && { password: this.password }),
				},
				timeoutMs: 10_000,
				token: this.token || undefined,
				password: this.password || undefined,
			});
			this.connecting = false;
			this.callbacks.onConnect({
				url: wsUrl,
				token: this.token || undefined,
				password: this.password || undefined,
			});
		} catch (e) {
			this.connecting = false;
			const msg = (e as Error).message;
			if (msg.includes("invalid request frame") || msg.includes("Invalid")) {
				this.error = "该地址可能不是 monoU Gateway，请确认 9347 上运行的是 monoU：npm run gateway";
			} else {
				this.error = msg;
			}
			this.tui.requestRender();
		}
	}

	getFocusable(): Input {
		return this.input;
	}

	render(width: number): string[] {
		const lines: string[] = [];
		lines.push("");
		lines.push(truncateToWidth(theme.header(TITLE), width, ""));
		lines.push(truncateToWidth(theme.dim(SUBTITLE), width, ""));
		lines.push("");
		for (let i = 0; i < 3; i++) {
			const label = PROMPTS[i]!;
			const display = i === this.step ? "" : i === 2 && this.password ? "••••••••" : this.valueForStep(i) || "—";
			lines.push(truncateToWidth(theme.dim(label + ": ") + (display ? theme.fg(display) : ""), width, ""));
			if (i === this.step) {
				lines.push(...this.input.render(width));
			}
			lines.push("");
		}
		if (this.error) {
			lines.push(truncateToWidth(theme.error("✕ " + this.error), width, ""));
			lines.push("");
		}
		if (this.connecting) {
			lines.push(truncateToWidth(theme.accent("正在连接…"), width, ""));
		}
		lines.push(truncateToWidth(theme.footerHint(FOOTER), width, ""));
		return lines;
	}

	handleInput?(data: string): void {
		this.input.handleInput?.(data);
	}
}
