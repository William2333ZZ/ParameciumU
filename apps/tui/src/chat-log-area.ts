/**
 * 聊天记录区域组件：仅渲染消息列表（供 OpenClaw 风格布局使用）
 */
import type { Component } from "@monou/tui";
import { truncateToWidth, wrapTextWithAnsi } from "@monou/tui";
import { theme } from "./theme.js";

const LABEL_WIDTH = 6;
const MAX_LINES_PER_MESSAGE = 40;
const HISTORY_LABEL = "--- 历史记录 ---";
const EMPTY_HINT = "输入消息开始对话，/help 查看命令";

export type Message = {
  role: "user" | "assistant" | "system";
  content: string;
  toolCalls?: Array<{ name: string; arguments?: string }>;
};

export class ChatLogArea implements Component {
  messages: Message[] = [];
  private maxLines = 200;
  private tailCount = 30;

  invalidate(): void {}

  render(width: number): string[] {
    const lines: string[] = [];
    const trunc = (s: string) => truncateToWidth(s, width, "");
    const contentWidth = Math.max(1, width - LABEL_WIDTH);
    const indent = " ".repeat(LABEL_WIDTH);

    if (this.messages.length === 0) {
      lines.push(trunc(theme.dim(EMPTY_HINT)));
      return lines;
    }

    lines.push(trunc(theme.dim(HISTORY_LABEL)));
    lines.push("");

    let used = 0;
    const start = Math.max(0, this.messages.length - this.tailCount);
    for (let i = start; i < this.messages.length && used < this.maxLines; i++) {
      const msg = this.messages[i]!;
      const block = this.renderMessage(msg, width);
      for (const line of block) {
        if (used >= this.maxLines) break;
        lines.push(trunc(line));
        used++;
      }
    }
    return lines;
  }

  private renderMessage(msg: Message, width: number): string[] {
    const out: string[] = [];
    const contentWidth = Math.max(1, width - LABEL_WIDTH);
    const indent = " ".repeat(LABEL_WIDTH);

    if (msg.role === "user") {
      const wrapped = wrapTextWithAnsi(msg.content, contentWidth);
      for (let i = 0; i < Math.min(wrapped.length, MAX_LINES_PER_MESSAGE); i++) {
        out.push(
          i === 0
            ? theme.userLabel() + theme.userText(wrapped[i]!)
            : indent + theme.userText(wrapped[i]!),
        );
      }
      if (wrapped.length > MAX_LINES_PER_MESSAGE) out.push(theme.dim(indent + "..."));
    } else if (msg.role === "assistant") {
      const wrapped = wrapTextWithAnsi(msg.content, contentWidth);
      for (let i = 0; i < Math.min(wrapped.length, MAX_LINES_PER_MESSAGE); i++) {
        out.push(
          i === 0
            ? theme.assistantLabel() + theme.fg(wrapped[i]!)
            : indent + theme.fg(wrapped[i]!),
        );
      }
      if (wrapped.length > MAX_LINES_PER_MESSAGE) out.push(theme.dim(indent + "..."));
      if (msg.toolCalls?.length) {
        const line = msg.toolCalls
          .map((t) => `${t.name}(${t.arguments ?? ""})`)
          .join(", ");
        out.push(
          theme.dim("   • ") + theme.toolTitle(truncateToWidth(line, width - 4, "")),
        );
      }
    } else {
      const wrapped = wrapTextWithAnsi(msg.content, width - 2);
      for (let i = 0; i < Math.min(wrapped.length, MAX_LINES_PER_MESSAGE); i++) {
        out.push(theme.dim("  ") + theme.system(wrapped[i]!));
      }
    }
    return out;
  }
}
