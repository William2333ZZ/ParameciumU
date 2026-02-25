/**
 * 会话面板 — 与 Web SessionsPanel 对齐：sessions.list，选会话后打开对话
 */
import { matchesKey, SelectList, truncateToWidth } from "@monou/tui";
import type { Component } from "@monou/tui";
import { theme, selectListTheme } from "./theme.js";
import type { GatewayClient } from "./gateway-client.js";

type SessionEntry = { key: string; displayName?: string; updatedAt?: number };

const TITLE = "会话";
const FOOTER = "↑↓ 选择  Enter 打开对话  Esc 返回";

export type SessionsPanelCallbacks = {
  onOpenSession: (agentId: string, sessionKey: string) => void;
};

function agentIdFromKey(key: string): string {
  const parts = key.split(":");
  return parts[1] ?? ".u";
}

export class SessionsPanel implements Component {
  private gw: GatewayClient;
  private sessions: SessionEntry[] = [];
  private loading = true;
  private err: string | null = null;
  private selectedIndex = 0;
  private callbacks: SessionsPanelCallbacks;

  constructor(gw: GatewayClient, callbacks: SessionsPanelCallbacks) {
    this.gw = gw;
    this.callbacks = callbacks;
  }

  invalidate(): void {}

  async load(): Promise<void> {
    this.loading = true;
    this.err = null;
    try {
      const res = await this.gw.call<{ sessions?: SessionEntry[] }>("sessions.list", {}, 8000);
      this.sessions = res?.sessions ?? [];
      this.selectedIndex = 0;
    } catch (e) {
      this.err = (e as Error).message;
      this.sessions = [];
    }
    this.loading = false;
  }

  render(width: number): string[] {
    const lines: string[] = [];
    lines.push(truncateToWidth(theme.header(TITLE), width, ""));
    lines.push("");
    if (this.loading) {
      lines.push(truncateToWidth(theme.dim("  加载中…"), width, ""));
      lines.push("");
      lines.push(truncateToWidth(theme.footerHint(FOOTER), width, ""));
      return lines;
    }
    if (this.err) {
      lines.push(truncateToWidth(theme.error("✕ " + this.err), width, ""));
      lines.push("");
      lines.push(truncateToWidth(theme.footerHint(FOOTER), width, ""));
      return lines;
    }
    if (this.sessions.length === 0) {
      lines.push(truncateToWidth(theme.dim("  暂无会话"), width, ""));
    } else {
      const maxShow = Math.max(1, Math.floor((typeof process !== "undefined" && process.stdout?.rows ? process.stdout.rows - 8 : 12)));
      for (let i = 0; i < Math.min(this.sessions.length, maxShow); i++) {
        const s = this.sessions[i]!;
        const label = (s.displayName || s.key).slice(0, width - 20);
        const date = s.updatedAt ? new Date(s.updatedAt).toLocaleString(undefined, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
        const raw = `  ${i === this.selectedIndex ? "→ " : "  "}${label}  ${date}`;
        lines.push(truncateToWidth(i === this.selectedIndex ? theme.accent(raw) : theme.fg(raw), width, ""));
      }
    }
    lines.push("");
    lines.push(truncateToWidth(theme.footerHint(FOOTER), width, ""));
    return lines;
  }

  handleInput?(data: string): void {
    if (matchesKey(data, "escape")) return;
    if (this.sessions.length === 0) return;
    if (matchesKey(data, "up")) {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      return;
    }
    if (matchesKey(data, "down")) {
      this.selectedIndex = Math.min(this.sessions.length - 1, this.selectedIndex + 1);
      return;
    }
    if (matchesKey(data, "enter")) {
      const s = this.sessions[this.selectedIndex];
      if (s) this.callbacks.onOpenSession(agentIdFromKey(s.key), s.key);
    }
  }
}
