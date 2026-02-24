#!/usr/bin/env node
/**
 * monoU TUI — 终端客户端，连接 Gateway 对话与 Cron（OpenClaw 风格布局）
 * 运行: npx monou-tui 或 npm run start
 * 环境变量: GATEWAY_WS_URL 或 GATEWAY_URL（默认 ws://127.0.0.1:9347）、GATEWAY_TOKEN、GATEWAY_PASSWORD
 */
import "dotenv/config";
import process from "node:process";
import type { Component } from "@monou/tui";
import { ProcessTerminal, TUI } from "@monou/tui";
import { CronPanel, type Job } from "./cron-panel.js";
import { ChatPanel } from "./chat-panel.js";
import { createGatewayClient } from "./gateway-client.js";

class AppRoot implements Component {
  mode: "chat" | "cron" = "chat";
  jobs: Job[] = [];
  private gw: ReturnType<typeof createGatewayClient>;
  private tui: TUI;
  cronPanel: CronPanel;
  chatPanel: ChatPanel;

  constructor(
    gw: ReturnType<typeof createGatewayClient>,
    tui: TUI,
  ) {
    this.gw = gw;
    this.tui = tui;
    this.cronPanel = new CronPanel(
      () => this.jobs,
      gw,
      tui,
      {
        onQuit: () => {
          tui.stop();
          process.exit(0);
        },
        onSwitchToChat: () => this.switchToChat(),
        onRefresh: () => this.refreshCronJobs(),
      },
    );
    this.chatPanel = new ChatPanel(tui, gw, { onSwitchToCron: () => this.switchToCron() }, {
      deviceId: "",
      sessionKey: "",
    });
  }

  async refreshCronJobs(): Promise<void> {
    try {
      const res = (await this.gw.call("cron.list", { includeDisabled: true }, 10_000)) as {
        jobs?: unknown[];
      };
      this.jobs = (res?.jobs ?? []) as Job[];
    } catch {
      this.jobs = [];
    }
    this.tui.requestRender();
  }

  switchToChat(): void {
    this.mode = "chat";
    this.tui.setFocus(this.chatPanel.editor);
    this.tui.requestRender();
  }

  switchToCron(): void {
    this.mode = "cron";
    this.tui.setFocus(this.cronPanel);
    this.tui.requestRender();
  }

  invalidate(): void {
    this.cronPanel.invalidate();
    this.chatPanel.invalidate();
  }

  render(width: number): string[] {
    if (this.mode === "cron") return this.cronPanel.render(width);
    return this.chatPanel.render(width);
  }

  handleInput?(data: string): void {
    if (this.mode === "cron") {
      this.cronPanel.handleInput?.(data);
    } else {
      this.chatPanel.handleInput?.(data);
    }
  }
}

async function runTui(): Promise<void> {
  const gw = createGatewayClient();
  process.stderr.write(`正在连接 Gateway ${gw.url} …\n`);

  await gw.call("connect", { role: "operator", deviceId: "tui-" + process.pid }, 5000);
  const agentsRes = (await gw.call("agents.list", {}, 5000)) as {
    agents?: Array<{ deviceId?: string; agentId?: string }>;
    defaultAgentId?: string;
  };
  const defaultAgentId = agentsRes?.defaultAgentId ?? ".u";
  const deviceId = agentsRes?.agents?.[0]?.deviceId ?? agentsRes?.agents?.[0]?.agentId ?? "";
  const sessionsRes = (await gw.call("sessions.list", {}, 5000)) as {
    sessions?: Array<{ key: string; updatedAt?: number }>;
  };
  const list = sessionsRes?.sessions ?? [];
  const latest = list.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0];
  const sessionKey = latest?.key ?? "";

  const terminal = new ProcessTerminal();
  const tui = new TUI(terminal);
  const root = new AppRoot(gw, tui);

  await root.refreshCronJobs();
  root.chatPanel.setDeviceId(deviceId);
  root.chatPanel.setSessionKey(sessionKey);
  root.chatPanel.defaultAgentId = defaultAgentId;
  root.chatPanel.setConnectionStatus("connected");
  await root.chatPanel.loadHistory();

  tui.addChild(root);
  tui.setFocus(root.chatPanel.editor);

  terminal.setTitle?.("monou TUI");
  terminal.clearScreen?.();
  tui.start();
}

function main(): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.log("TUI 需要在交互式终端中运行。");
    console.log("用法: npx monou-tui  或  npm run start");
    console.log("  对话: Enter 发送  /cron 定时任务  /help 帮助  q 在定时任务时退出");
    process.exit(1);
  }
  runTui().catch((err) => {
    console.error("TUI 运行失败:", err);
    process.exit(1);
  });
}

main();
