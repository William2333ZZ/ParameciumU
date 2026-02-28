/**
 * TUI 主视图 — 与 Web MainView 对齐：五 Tab（对话、拓扑、会话、Cron、设置）
 * 1-5 或 j/k 切换 Tab；特色界面参考 skills 的 frontend-design：清晰层级、高对比
 */
import type { Component, TUI } from "@monou/tui";
import { Container, matchesKey, truncateToWidth } from "@monou/tui";
import { ChatPanel } from "./chat-panel.js";
import { CronPanel, type Job } from "./cron-panel.js";
import type { GatewayClient } from "./gateway-client.js";
import { SessionsPanel } from "./sessions-panel.js";
import { SettingsPanel } from "./settings-panel.js";
import { theme } from "./theme.js";
import { TopologyPanel } from "./topology-panel.js";

export type TabId = "chat" | "topology" | "sessions" | "cron" | "settings";

const TAB_LABELS: { id: TabId; label: string }[] = [
	{ id: "chat", label: "对话" },
	{ id: "topology", label: "拓扑" },
	{ id: "sessions", label: "会话" },
	{ id: "cron", label: "Cron" },
	{ id: "settings", label: "设置" },
];

export type MainViewCallbacks = {
	onDisconnect: () => void;
	onQuit: () => void;
};

export class MainView extends Container implements Component {
	private tui: TUI;
	private gw: GatewayClient;
	private tab: TabId = "chat";
	private chatPanel: ChatPanel;
	private topologyPanel: TopologyPanel;
	private sessionsPanel: SessionsPanel;
	private cronPanel: CronPanel;
	private settingsPanel: SettingsPanel;
	private jobs: Job[] = [];
	private cronAgentIds: string[] = [];
	private cronSelectedAgentIndex = 0;
	private callbacks: MainViewCallbacks;

	constructor(
		tui: TUI,
		gw: GatewayClient,
		callbacks: MainViewCallbacks,
		opts: { deviceId: string; sessionKey: string; defaultAgentId: string },
	) {
		super();
		this.tui = tui;
		this.gw = gw;
		this.callbacks = callbacks;

		this.chatPanel = new ChatPanel(
			tui,
			gw,
			{ onSwitchToCron: () => this.setTab("cron") },
			{
				deviceId: opts.deviceId,
				sessionKey: opts.sessionKey,
			},
		);
		this.chatPanel.defaultAgentId = opts.defaultAgentId;

		this.topologyPanel = new TopologyPanel(gw);
		this.sessionsPanel = new SessionsPanel(gw, {
			onOpenSession: (agentId, sessionKey) => {
				this.chatPanel.setSessionKey(sessionKey);
				this.chatPanel.defaultAgentId = agentId;
				this.setTab("chat");
				this.tui.setFocus(this.chatPanel.editor);
			},
		});
		this.cronPanel = new CronPanel(
			() => this.jobs,
			gw,
			tui,
			{
				onQuit: callbacks.onQuit,
				onSwitchToChat: () => this.setTab("chat"),
				onRefresh: () => void this.refreshCronJobs(),
				onAgentPrev: () => this.cronSelectPrevAgent(),
				onAgentNext: () => this.cronSelectNextAgent(),
			},
			() => this.getCronAgentId(),
			() => this.cronAgentIds,
		);
		this.settingsPanel = new SettingsPanel(gw, tui, { onDisconnect: callbacks.onDisconnect });

		this.callbacks = callbacks;
	}

	setTab(t: TabId): void {
		this.tab = t;
		if (t === "chat") this.tui.setFocus(this.chatPanel.editor);
		else this.tui.setFocus(this);
		if (t === "topology") void this.topologyPanel.load();
		if (t === "sessions") void this.sessionsPanel.load();
		if (t === "cron") void this.refreshCronJobs();
		this.tui.requestRender();
	}

	getTab(): TabId {
		return this.tab;
	}

	getChatPanel(): ChatPanel {
		return this.chatPanel;
	}

	private getCronAgentId(): string {
		return this.cronAgentIds[this.cronSelectedAgentIndex] ?? ".u";
	}

	private cronSelectPrevAgent(): void {
		if (this.cronAgentIds.length <= 1) return;
		this.cronSelectedAgentIndex =
			(this.cronSelectedAgentIndex - 1 + this.cronAgentIds.length) % this.cronAgentIds.length;
		void this.refreshCronJobs();
		this.tui.requestRender();
	}

	private cronSelectNextAgent(): void {
		if (this.cronAgentIds.length <= 1) return;
		this.cronSelectedAgentIndex = (this.cronSelectedAgentIndex + 1) % this.cronAgentIds.length;
		void this.refreshCronJobs();
		this.tui.requestRender();
	}

	async refreshCronJobs(): Promise<void> {
		try {
			const agentsRes = (await this.gw.call("agents.list", {}, 5000)) as {
				agents?: Array<{ agentId?: string }>;
				defaultAgentId?: string;
			};
			const list = agentsRes?.agents ?? [];
			this.cronAgentIds = list.length > 0 ? list.map((a) => a.agentId ?? ".u") : [".u"];
			const defaultId = agentsRes?.defaultAgentId ?? ".u";
			if (!this.cronAgentIds.includes(this.getCronAgentId())) {
				const idx = this.cronAgentIds.indexOf(defaultId);
				this.cronSelectedAgentIndex = idx >= 0 ? idx : 0;
			}
			const agentId = this.getCronAgentId();
			const res = (await this.gw.call("cron.list", { agentId, includeDisabled: true }, 10_000)) as {
				jobs?: unknown[];
			};
			this.jobs = (res?.jobs ?? []) as Job[];
		} catch {
			this.jobs = [];
		}
		this.tui.requestRender();
	}

	invalidate(): void {
		this.chatPanel.invalidate();
	}

	renderNavLine(width: number): string {
		const parts = TAB_LABELS.map(({ id, label }) => {
			const num = TAB_LABELS.findIndex((x) => x.id === id) + 1;
			const active = this.tab === id;
			return active ? theme.accent(`[${num}]${label}`) : theme.dim(`${num} ${label}`);
		});
		return truncateToWidth(parts.join("  "), width, "");
	}

	render(width: number): string[] {
		const lines: string[] = [];
		lines.push(truncateToWidth(theme.header("monoU TUI") + theme.dim(" · ") + theme.fg(this.gw.url), width, ""));
		lines.push(truncateToWidth(theme.separatorLine(width - 2, "─"), width, ""));
		lines.push(this.renderNavLine(width));
		lines.push(truncateToWidth(theme.dim("  1-5 切换  j/k 下一/上一 Tab"), width, ""));
		lines.push("");

		const panelWidth = width;
		let panelLines: string[];
		if (this.tab === "chat") {
			panelLines = this.chatPanel.render(panelWidth);
		} else if (this.tab === "topology") {
			panelLines = this.topologyPanel.render(panelWidth);
		} else if (this.tab === "sessions") {
			panelLines = this.sessionsPanel.render(panelWidth);
		} else if (this.tab === "cron") {
			panelLines = this.cronPanel.render(panelWidth);
		} else {
			panelLines = this.settingsPanel.render(panelWidth);
		}
		lines.push(...panelLines);
		return lines;
	}

	handleInput?(data: string): void {
		const num = data === "1" ? 1 : data === "2" ? 2 : data === "3" ? 3 : data === "4" ? 4 : data === "5" ? 5 : 0;
		if (num >= 1 && num <= 5) {
			this.setTab(TAB_LABELS[num - 1]!.id);
			if (this.tab === "chat") this.tui.setFocus(this.chatPanel.editor);
			return;
		}
		if (matchesKey(data, "right") || data === "j") {
			const idx = TAB_LABELS.findIndex((x) => x.id === this.tab);
			const next = (idx + 1) % TAB_LABELS.length;
			this.setTab(TAB_LABELS[next]!.id);
			if (this.tab === "chat") this.tui.setFocus(this.chatPanel.editor);
			return;
		}
		if (matchesKey(data, "left") || data === "k") {
			const idx = TAB_LABELS.findIndex((x) => x.id === this.tab);
			const prev = (idx - 1 + TAB_LABELS.length) % TAB_LABELS.length;
			this.setTab(TAB_LABELS[prev]!.id);
			if (this.tab === "chat") this.tui.setFocus(this.chatPanel.editor);
			return;
		}

		if (this.tab === "chat") {
			this.chatPanel.handleInput?.(data);
		} else if (this.tab === "topology") {
			// no input
		} else if (this.tab === "sessions") {
			this.sessionsPanel.handleInput?.(data);
		} else if (this.tab === "cron") {
			this.cronPanel.handleInput?.(data);
		} else {
			this.settingsPanel.handleInput?.(data);
		}
	}
}
