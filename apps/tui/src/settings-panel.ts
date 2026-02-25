/**
 * 设置面板 — 与 Web SettingsPanel 对齐：当前连接、断开、调试信息（health/status）
 */
import { truncateToWidth } from "@monou/tui";
import type { Component } from "@monou/tui";
import type { TUI } from "@monou/tui";
import { theme } from "./theme.js";
import type { GatewayClient } from "./gateway-client.js";

const TITLE = "设置";
const FOOTER = "d 断开连接  Enter 展开/收起调试信息";

export type SettingsPanelCallbacks = {
  onDisconnect: () => void;
};

export class SettingsPanel implements Component {
  private gw: GatewayClient;
  private tui: TUI;
  private debugOpen = false;
  private debugData: string | null = null;
  private debugErr: string | null = null;
  private callbacks: SettingsPanelCallbacks;

  constructor(gw: GatewayClient, tui: TUI, callbacks: SettingsPanelCallbacks) {
    this.gw = gw;
    this.tui = tui;
    this.callbacks = callbacks;
  }

  invalidate(): void {}

  async toggleDebug(): Promise<void> {
    this.debugOpen = !this.debugOpen;
    if (this.debugOpen && this.debugData === null && !this.debugErr) {
      try {
        const [health, status] = await Promise.all([
          this.gw.call<unknown>("health", {}, 5000),
          this.gw.call<unknown>("status", {}, 5000),
        ]);
        const obj: Record<string, unknown> = { health, status };
        if (obj.status && typeof obj.status === "object" && obj.status !== null && "cron" in obj.status) {
          const s = { ...(obj.status as Record<string, unknown>) };
          delete s.cron;
          obj.status = s;
        }
        this.debugData = JSON.stringify(obj, null, 2);
      } catch (e) {
        this.debugErr = (e as Error).message;
      }
      this.tui.requestRender();
    }
  }

  render(width: number): string[] {
    const lines: string[] = [];
    lines.push(truncateToWidth(theme.header(TITLE), width, ""));
    lines.push("");
    lines.push(truncateToWidth(theme.dim("  当前连接: ") + theme.fg(this.gw.url), width, ""));
    lines.push("");
    lines.push(truncateToWidth(theme.footerHint("  按 d 断开并返回连接屏"), width, ""));
    lines.push("");
    lines.push(truncateToWidth(theme.dim("  ▶ 调试信息（health/status，不含 cron）  Enter 展开"), width, ""));
    if (this.debugOpen) {
      if (this.debugErr) {
        lines.push(truncateToWidth(theme.error("  ✕ " + this.debugErr), width, ""));
      } else if (this.debugData) {
        const maxLines = 20;
        const dataLines = this.debugData.split("\n");
        for (let i = 0; i < Math.min(dataLines.length, maxLines); i++) {
          lines.push(truncateToWidth(theme.dim("  ") + theme.fg(dataLines[i]!), width, ""));
        }
        if (dataLines.length > maxLines) {
          lines.push(truncateToWidth(theme.dim("  …"), width, ""));
        }
      }
    }
    lines.push("");
    lines.push(truncateToWidth(theme.footerHint(FOOTER), width, ""));
    return lines;
  }

  handleInput?(data: string): void {
    if (data === "d" || data === "D") {
      this.callbacks.onDisconnect();
      return;
    }
    if (data === "\r" || data === "\n") {
      void this.toggleDebug();
    }
  }
}
