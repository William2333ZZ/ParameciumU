/**
 * Cron 面板：任务列表来自 Gateway cron.list，Enter 菜单调用 cron.run / cron.update
 */

import type { Component, TUI } from "@monou/tui";
import { matchesKey, SelectList, truncateToWidth } from "@monou/tui";
import type { GatewayClient } from "./gateway-client.js";
import { selectListTheme, theme } from "./theme.js";

const TITLE = "Cron · 定时任务";
const FOOTER = "c 对话  a/d 切换 Agent  q 退出  ↑↓ 选择  Enter 操作";

export type Schedule =
	| { kind: "at"; at: string }
	| { kind: "every"; everyMs: number }
	| { kind: "cron"; expr: string; tz?: string };

export type Job = {
	id: string;
	name?: string;
	schedule: Schedule;
	state?: { nextRunAtMs?: number };
	enabled?: boolean;
};

function formatSchedule(schedule: Schedule): string {
	switch (schedule.kind) {
		case "at":
			return `at ${schedule.at}`;
		case "every":
			return `every ${schedule.everyMs}ms`;
		case "cron":
			return schedule.tz ? `cron ${schedule.expr} (${schedule.tz})` : `cron ${schedule.expr}`;
		default:
			return String(schedule);
	}
}

function formatNextRun(nextRunAtMs: number | null | undefined): string {
	if (nextRunAtMs == null) return "—";
	const d = new Date(nextRunAtMs);
	return d.toLocaleString(undefined, {
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function jobLine(job: Job, selected: boolean, _width: number): string {
	const maxName = 18;
	const maxSched = 24;
	const name = (job.name || "Untitled").slice(0, maxName).padEnd(maxName);
	const sched = formatSchedule(job.schedule).slice(0, maxSched).padEnd(maxSched);
	const next = formatNextRun(job.state?.nextRunAtMs);
	const on = job.enabled ? "✓" : "—";
	const raw = `  ${on} ${name} ${sched} ${next}`;
	return selected ? theme.accent(raw) : theme.fg(raw);
}

export type CronPanelCallbacks = {
	onQuit: () => void;
	onSwitchToChat: () => void;
	onRefresh: () => void;
	onAgentPrev?: () => void;
	onAgentNext?: () => void;
};

export class CronPanel implements Component {
	private selectedIndex = 0;

	constructor(
		private getJobs: () => Job[],
		private gw: GatewayClient,
		private tui: TUI,
		private callbacks: CronPanelCallbacks,
		private getAgentId: () => string = () => ".u",
		private getAgentIds: () => string[] = () => [".u"],
	) {}

	invalidate(): void {}

	render(width: number): string[] {
		const jobs = this.getJobs();
		const agentId = this.getAgentId();
		const agentIds = this.getAgentIds();
		const lines: string[] = [];
		lines.push(truncateToWidth(theme.header(TITLE), width, ""));
		lines.push("");
		const agentLine = `  Agent: ${theme.accent(agentId)}  ${agentIds.length > 1 ? theme.dim("a 上一个 d 下一个") : ""}`;
		lines.push(truncateToWidth(agentLine, width, ""));
		lines.push("");
		if (jobs.length === 0) {
			lines.push(truncateToWidth(theme.dim("  (无定时任务)"), width, ""));
		} else {
			for (let i = 0; i < jobs.length; i++) {
				lines.push(truncateToWidth(jobLine(jobs[i]!, i === this.selectedIndex, width), width, ""));
			}
		}
		lines.push("");
		lines.push(truncateToWidth(theme.footerHint(FOOTER), width, ""));
		return lines;
	}

	handleInput?(data: string): void {
		const jobs = this.getJobs();
		if (matchesKey(data, "q") || matchesKey(data, "escape")) {
			this.callbacks.onQuit();
			return;
		}
		if (matchesKey(data, "c")) {
			this.callbacks.onSwitchToChat();
			return;
		}
		if (data === "a" || data === "A") {
			this.callbacks.onAgentPrev?.();
			return;
		}
		if (data === "d" || data === "D") {
			this.callbacks.onAgentNext?.();
			return;
		}
		if (jobs.length === 0) return;
		if (matchesKey(data, "up")) {
			this.selectedIndex = Math.max(0, this.selectedIndex - 1);
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, "down")) {
			this.selectedIndex = Math.min(jobs.length - 1, this.selectedIndex + 1);
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, "enter")) {
			this.showActionOverlay();
			return;
		}
	}

	private showActionOverlay(): void {
		const jobs = this.getJobs();
		const job = jobs[this.selectedIndex];
		if (!job) return;
		const items = [
			{ value: "run", label: "运行", description: "立即执行一次" },
			{
				value: "toggle",
				label: job.enabled ? "禁用" : "启用",
				description: job.enabled ? "暂停该任务" : "启用该任务",
			},
			{ value: "back", label: "返回" },
		];
		const selectList = new SelectList(items, 5, selectListTheme);
		const handle = this.tui.showOverlay(selectList, {
			anchor: "center",
			width: 36,
			maxHeight: 10,
		});
		const agentId = this.getAgentId();
		selectList.onSelect = async (item: { value: string }) => {
			handle.hide();
			try {
				if (item.value === "run") {
					await this.gw.call("cron.run", { id: job.id, agentId, mode: "force" }, 10_000);
				} else if (item.value === "toggle") {
					await this.gw.call("cron.update", { id: job.id, agentId, patch: { enabled: !job.enabled } }, 10_000);
				}
			} catch {
				// ignore
			}
			this.callbacks.onRefresh();
			this.tui.requestRender();
		};
		selectList.onCancel = () => {
			handle.hide();
			this.tui.requestRender();
		};
		this.tui.setFocus(selectList);
		this.tui.requestRender();
	}
}
