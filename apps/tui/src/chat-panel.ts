/**
 * Chat 面板 — OpenClaw 风格：Header | ChatLog | Status | Footer | Editor
 * 命令：/help、/clear、/cron；!cmd 本地 shell；Enter 发送
 */
import { execSync } from "node:child_process";
import {
  Container,
  Editor,
  Loader,
  Text,
  type TUI,
  truncateToWidth,
} from "@monou/tui";
import type { Component } from "@monou/tui";
import { theme, editorTheme } from "./theme.js";
import type { GatewayClient } from "./gateway-client.js";
import { ChatLogArea, type Message } from "./chat-log-area.js";
import { getSubmitAction } from "./chat-submit.js";

const FOOTER_HINT = "Enter 发送  /help /clear /cron  !cmd  Esc 清空";
const SLASH_HELP = `命令:
  /help    本帮助
  /clear   清空当前会话显示（不删服务端历史）
  /cron    进入 Cron 面板`;

const STATUS_IDLE = "idle";
const STATUS_RUNNING = "thinking";

function formatSessionKey(key: string): string {
  if (!key) return "—";
  const parts = key.split(":");
  return parts[parts.length - 1] ?? key;
}

export class ChatPanel extends Container implements Component {
  readonly tui: TUI;
  readonly gw: GatewayClient;
  readonly chatLog: ChatLogArea;
  readonly editor: Editor;

  private headerText: Text;
  private statusContainer: Container;
  private statusText: Text | null = null;
  private statusLoader: Loader | null = null;
  private footerText: Text;
  private footerHintText: Text;

  deviceId = "";
  sessionKey = "";
  defaultAgentId = ".u";
  connectionStatus = "connecting";
  activityStatus = STATUS_IDLE;
  statusError = "";

  private callbacks: { onSwitchToCron: () => void };

  constructor(
    tui: TUI,
    gw: GatewayClient,
    callbacks: { onSwitchToCron: () => void },
    opts: { deviceId: string; sessionKey: string },
  ) {
    super();
    this.tui = tui;
    this.gw = gw;
    this.callbacks = callbacks;
    this.deviceId = opts.deviceId;
    this.sessionKey = opts.sessionKey;

    this.headerText = new Text("", 1, 0);
    this.chatLog = new ChatLogArea();
    this.statusContainer = new Container();
    this.footerText = new Text("", 1, 0);
    this.footerHintText = new Text(theme.footerHint(FOOTER_HINT), 1, 0);
    this.editor = new Editor(tui, editorTheme, { paddingX: 1 });

    this.addChild(this.headerText);
    this.addChild(this.chatLog);
    this.addChild(this.statusContainer);
    this.addChild(this.footerText);
    this.addChild(this.footerHintText);
    this.addChild(this.editor);

    this.editor.onSubmit = (text: string) => this.handleSubmit(text);

    this.updateHeader();
    this.renderStatus();
    this.updateFooter();
  }

  setSessionKey(key: string): void {
    this.sessionKey = key;
    this.updateHeader();
    this.updateFooter();
  }

  setDeviceId(id: string): void {
    this.deviceId = id;
    this.updateHeader();
  }

  setConnectionStatus(status: string): void {
    this.connectionStatus = status;
    this.renderStatus();
  }

  setActivityStatus(status: string): void {
    this.activityStatus = status;
    this.renderStatus();
  }

  private updateHeader(): void {
    const sessionLabel = formatSessionKey(this.sessionKey);
    const agentLabel = this.defaultAgentId || ".u";
    this.headerText.setText(
      theme.header(
        `monou tui - ${this.gw.url} - agent ${agentLabel} - session ${sessionLabel}`,
      ),
    );
  }

  private ensureStatusText(): void {
    if (this.statusText) return;
    this.statusContainer.clear();
    this.statusLoader?.stop();
    this.statusLoader = null;
    this.statusText = new Text("", 1, 0);
    this.statusContainer.addChild(this.statusText);
  }

  private ensureStatusLoader(): void {
    if (this.statusLoader) return;
    this.statusContainer.clear();
    this.statusText = null;
    this.statusLoader = new Loader(
      this.tui,
      (s) => theme.accent(s),
      (s) => theme.dim(s),
      "…",
    );
    this.statusContainer.addChild(this.statusLoader);
  }

  private renderStatus(): void {
    const busy = this.activityStatus === STATUS_RUNNING;
    if (busy) {
      this.ensureStatusLoader();
      this.statusLoader?.setMessage(
        this.statusError ? this.statusError : "发送中…",
      );
    } else {
      this.statusLoader?.stop();
      this.statusLoader = null;
      this.ensureStatusText();
      const text = this.statusError
        ? theme.error("✕ " + this.statusError)
        : theme.dim(`${this.connectionStatus} | ${this.activityStatus}`);
      this.statusText?.setText(text);
    }
  }

  private updateFooter(): void {
    const sessionLabel = formatSessionKey(this.sessionKey);
    const agentLabel = this.defaultAgentId || ".u";
    this.footerText.setText(
      theme.dim(`agent ${agentLabel} | session ${sessionLabel}`),
    );
  }

  invalidate(): void {
    this.editor.invalidate?.();
    this.chatLog.invalidate();
  }

  async loadHistory(): Promise<void> {
    try {
      const params: Record<string, unknown> = { limit: 50 };
      if (this.sessionKey) params.sessionKey = this.sessionKey;
      const res = (await this.gw.call("chat.history", params, 10_000)) as {
        messages?: Array<{ role: string; content?: string; toolCalls?: unknown[] }>;
      };
      const list = res?.messages ?? [];
      this.chatLog.messages = list.map((m) => ({
        role:
          m.role === "user"
            ? "user"
            : m.role === "assistant"
              ? "assistant"
              : "system",
        content: typeof m.content === "string" ? m.content : "",
        ...(m.toolCalls?.length && { toolCalls: m.toolCalls as Message["toolCalls"] }),
      }));
    } catch {
      this.chatLog.messages = [];
    }
    this.tui.requestRender();
  }

  handleInput?(data: string): void {
    this.editor.handleInput?.(data);
  }

  private async handleSubmit(raw: string): Promise<void> {
    const action = getSubmitAction(raw);
    this.editor.setText("");
    if (!action) return;
    const value = raw.trim();
    this.editor.addToHistory?.(value);

    switch (action.type) {
      case "help":
        this.chatLog.messages.push({ role: "system", content: SLASH_HELP });
        this.tui.requestRender();
        return;
      case "clear":
        this.chatLog.messages = [];
        this.tui.requestRender();
        return;
      case "cron":
        this.callbacks.onSwitchToCron();
        return;
      case "unknown_cmd":
        this.chatLog.messages.push({
          role: "system",
          content: `未知命令: ${action.raw}，输入 /help 查看帮助。`,
        });
        this.tui.requestRender();
        return;
      case "bang": {
        try {
          const result = execSync(action.cmd, { encoding: "utf8", timeout: 10000 });
          this.chatLog.messages.push({
            role: "system",
            content: `$ ${action.cmd}\n${result}`,
          });
        } catch (err) {
          this.chatLog.messages.push({
            role: "system",
            content: `$ ${action.cmd}\n错误: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
        this.tui.requestRender();
        return;
      }
      case "message":
        break;
    }

    this.chatLog.messages.push({ role: "user", content: action.value });
    this.chatLog.messages.push({ role: "assistant", content: "" });
    this.setActivityStatus(STATUS_RUNNING);
    this.statusError = "";
    this.tui.requestRender();

    try {
      const params: Record<string, unknown> = { message: action.value };
      if (this.deviceId) params.deviceId = this.deviceId;
      if (this.sessionKey) params.sessionKey = this.sessionKey;
      const res = (await this.gw.call("chat.send", params, 90_000)) as {
        text?: string;
        toolCalls?: Array<{ name: string; arguments?: string }>;
      };
      this.setActivityStatus(STATUS_IDLE);
      const last = this.chatLog.messages[this.chatLog.messages.length - 1];
      if (last && last.role === "assistant") {
        last.content = res?.text ?? "";
        if (res?.toolCalls?.length) last.toolCalls = res.toolCalls;
        if (!last.content && last.toolCalls?.length)
          last.content = "(已执行工具)";
      }
      if (!this.sessionKey) {
        const sessions = (await this.gw.call("sessions.list", {}, 5000)) as {
          sessions?: Array<{ key: string; updatedAt?: number }>;
        };
        const list = sessions?.sessions ?? [];
        const latest = list.sort(
          (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
        )[0];
        if (latest?.key) {
          this.sessionKey = latest.key;
          this.updateHeader();
          this.updateFooter();
        }
      }
    } catch (err) {
      this.setActivityStatus(STATUS_IDLE);
      this.statusError = err instanceof Error ? err.message : String(err);
      const last = this.chatLog.messages[this.chatLog.messages.length - 1];
      if (last && last.role === "assistant") {
        last.content = "错误: " + this.statusError;
      } else {
        this.chatLog.messages.push({
          role: "system",
          content: "错误: " + this.statusError,
        });
      }
    }
    this.tui.requestRender();
  }
}
