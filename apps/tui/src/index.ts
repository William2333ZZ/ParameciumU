#!/usr/bin/env node
/**
 * monoU TUI — 终端客户端，与 Control UI 同源：先配置 Gateway，再进入五 Tab（对话、拓扑、会话、Cron、设置）
 * 运行: npx monou-tui 或 npm run start
 * 环境变量: GATEWAY_WS_URL / GATEWAY_URL（默认 ws://127.0.0.1:9347）、GATEWAY_TOKEN、GATEWAY_PASSWORD（可选，首屏可填）
 */
import "dotenv/config";
import process from "node:process";
import { ProcessTerminal, TUI } from "@monou/tui";
import { ConnectScreen } from "./connect-screen.js";
import type { GatewayConnectionOptions } from "./gateway-client.js";
import { createGatewayClient } from "./gateway-client.js";
import { MainView } from "./main-view.js";

async function runTui(): Promise<void> {
	const terminal = new ProcessTerminal();
	const tui = new TUI(terminal);
	terminal.setTitle?.("monoU TUI");
	terminal.clearScreen?.();

	let currentRoot: ConnectScreen | MainView;

	const showMainView = async (options: GatewayConnectionOptions): Promise<void> => {
		const gw = createGatewayClient(options);
		const agentsRes = (await gw.call("agents.list", {}, 5000)) as {
			agents?: Array<{ deviceId?: string; agentId?: string }>;
			defaultAgentId?: string;
		};
		const defaultAgentId = agentsRes?.defaultAgentId ?? ".u";
		const sessionsRes = (await gw.call("sessions.list", {}, 5000)) as {
			sessions?: Array<{ key: string; updatedAt?: number }>;
		};
		const list = sessionsRes?.sessions ?? [];
		const latest = list.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0];
		const sessionKey = latest?.key ?? "";
		const deviceId = agentsRes?.agents?.[0]?.deviceId ?? agentsRes?.agents?.[0]?.agentId ?? "";

		const main = new MainView(
			tui,
			gw,
			{
				onDisconnect: () => {
					tui.removeChild(main);
					const connect = new ConnectScreen(tui, {
						onConnect: (opts) => void showMainView(opts),
						onCancel: () => {
							tui.stop();
							process.exit(0);
						},
					});
					tui.addChild(connect);
					currentRoot = connect;
					tui.setFocus(connect.getFocusable());
					tui.requestRender();
				},
				onQuit: () => {
					tui.stop();
					process.exit(0);
				},
			},
			{ deviceId, sessionKey, defaultAgentId },
		);

		main.getChatPanel().setDeviceId(deviceId);
		main.getChatPanel().setConnectionStatus("connected");
		await main.getChatPanel().loadHistory();

		tui.removeChild(currentRoot);
		currentRoot = main;
		tui.addChild(main);
		tui.setFocus(main.getChatPanel().editor);
		tui.requestRender();
	};

	const connectScreen = new ConnectScreen(tui, {
		onConnect: (opts) => void showMainView(opts),
		onCancel: () => {
			tui.stop();
			process.exit(0);
		},
	});

	currentRoot = connectScreen;
	tui.addChild(connectScreen);
	tui.setFocus(connectScreen.getFocusable());
	tui.start();
}

function main(): void {
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		console.log("TUI 需要在交互式终端中运行。");
		console.log("用法: npx monou-tui  或  npm run start");
		console.log("  首屏配置 Gateway URL/Token/Password；连接后 1-5 或 j/k 切换 Tab：对话、拓扑、会话、Cron、设置");
		process.exit(1);
	}
	runTui().catch((err) => {
		console.error("TUI 运行失败:", err);
		process.exit(1);
	});
}

main();
