#!/usr/bin/env node
/**
 * Feishu Node：以 role=node 连接 Gateway，声明 capabilities: ["feishu"]，处理 node.invoke.request（feishu.send）；
 * 同时以 Connector 身份连 Gateway + 飞书 WebSocket，收消息走 connector.message.inbound，收 connector.message.push 回发飞书。
 *
 * 环境变量: GATEWAY_URL / GATEWAY_WS_URL, FEISHU_NODE_ID（默认 feishu-1）, FEISHU_APP_ID, FEISHU_APP_SECRET,
 * CONNECTOR_ID, CONNECTOR_DISPLAY_NAME, FEISHU_DOMAIN
 */
import "dotenv/config";
import process from "node:process";
import WebSocket from "ws";
import { loadConfig, getNodeId } from "./config.js";
import { createEventDispatcher, createFeishuWSClient, registerInboundHandler } from "./feishu-client.js";
import { createGatewayConnectorClient } from "./gateway-connector-client.js";
import { sendMessage } from "./send.js";

const CAPABILITIES = ["feishu"];

function toUtf8String(data: Buffer | ArrayBuffer): string {
	if (typeof data === "string") return data;
	if (data instanceof Buffer) return data.toString("utf8");
	return Buffer.from(new Uint8Array(data)).toString("utf8");
}

function sendNodeResult(
	ws: WebSocket,
	invokeId: string,
	result: { ok: boolean; payload?: unknown; error?: { code: string; message: string } },
) {
	if (ws.readyState !== 1) return;
	try {
		ws.send(JSON.stringify({ method: "node.invoke.result", params: { id: invokeId, result }, id: `result-${invokeId}` }));
	} catch (e) {
		console.error("[feishu-node] sendNodeResult failed:", e instanceof Error ? e.message : e);
	}
}

async function main() {
	const config = loadConfig();
	const nodeId = getNodeId();
	const log = (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`);
	log(`Feishu Node starting (nodeId=${nodeId}, connectorId=${config.connectorId})`);
	log(`Gateway: ${config.gatewayWsUrl}`);

	const gatewayWsUrl = config.gatewayWsUrl.trim().replace(/^http/, "ws").replace(/\/?$/, "");
	if (!gatewayWsUrl.startsWith("ws")) {
		throw new Error("GATEWAY_WS_URL / GATEWAY_URL must be ws:// or wss://");
	}

	// --- Connector + Feishu WS（收消息与推送）---
	const gatewayClient = await createGatewayConnectorClient(config, config.connectorId, log, {
		onPush: async (payload) => {
			try {
				await sendMessage(config, {
					receiveId: payload.chatId,
					receiveIdType: "chat_id",
					text: payload.text,
					replyToMessageId: payload.replyToId,
				});
				log(`[push] sent to chat ${payload.chatId}`);
			} catch (err) {
				log(`[push] failed to send to chat ${payload.chatId}: ${String(err)}`);
			}
		},
	});
	const gatewayRequest = (method: string, params?: Record<string, unknown>) =>
		gatewayClient.request(method, params);

	const wsClient = createFeishuWSClient(config);
	const eventDispatcher = createEventDispatcher(config);
	registerInboundHandler(eventDispatcher, config, log, gatewayRequest);

	wsClient
		.start({ eventDispatcher })
		.then(() => log("Feishu WebSocket connected"))
		.catch((err) => {
			log(`Feishu WebSocket error: ${String(err)}`);
			process.exit(1);
		});

	// --- Node 连接：供 gateway_node_invoke(nodeId, "feishu.send", params) ---
	const nodeWs = new WebSocket(gatewayWsUrl);

	nodeWs.on("open", () => {
		nodeWs.send(
			JSON.stringify({
				method: "connect",
				params: { role: "node", deviceId: nodeId, capabilities: CAPABILITIES },
				id: "connect-1",
			}),
		);
	});

	nodeWs.on("message", async (data: Buffer | ArrayBuffer) => {
		let msg: { event?: string; payload?: { id?: string; command?: string; params?: Record<string, unknown> } };
		try {
			msg = JSON.parse(toUtf8String(data)) as typeof msg;
		} catch {
			return;
		}
		if (msg.event !== "node.invoke.request" || !msg.payload) return;
		const { id: invokeId, command, params = {} } = msg.payload;
		if (!invokeId || !command) return;

		if (command === "feishu.send") {
			const receiveId = typeof params.receiveId === "string" ? params.receiveId.trim() : "";
			const receiveIdType = params.receiveIdType === "open_id" ? "open_id" : "chat_id";
			const text = typeof params.text === "string" ? params.text : "";
			const replyToMessageId = typeof params.replyToMessageId === "string" ? params.replyToMessageId : undefined;
			if (!receiveId) {
				sendNodeResult(nodeWs, invokeId, {
					ok: false,
					error: { code: "INVALID_PARAMS", message: "feishu.send 需要 params.receiveId" },
				});
				return;
			}
			try {
				const result = await sendMessage(config, {
					receiveId,
					receiveIdType,
					text,
					replyToMessageId,
				});
				sendNodeResult(nodeWs, invokeId, { ok: true, payload: result });
			} catch (e) {
				const message = e instanceof Error ? e.message : String(e);
				sendNodeResult(nodeWs, invokeId, { ok: false, error: { code: "FEISHU_ERROR", message } });
			}
			return;
		}

		sendNodeResult(nodeWs, invokeId, {
			ok: false,
			error: { code: "UNAVAILABLE", message: `command not supported: ${command}` },
		});
	});

	const onFirstNodeMessage = (data: Buffer | ArrayBuffer) => {
		let msg: { id?: string; ok?: boolean; error?: { message?: string } };
		try {
			msg = JSON.parse(toUtf8String(data)) as typeof msg;
		} catch {
			return;
		}
		if (msg.id === "connect-1") {
			nodeWs.off("message", onFirstNodeMessage);
			if (msg.ok !== true) {
				console.error("Node connect failed:", msg.error?.message ?? "unknown");
				process.exit(1);
			}
			log(`[node] connected as node ${nodeId}, capabilities=${CAPABILITIES.join(",")}`);
		}
	};
	nodeWs.once("message", onFirstNodeMessage);

	nodeWs.on("close", () => {
		log("[node] Gateway node connection closed");
	});
	nodeWs.on("error", (err) => {
		log(`[node] WebSocket error: ${err.message}`);
	});

	process.on("SIGINT", () => {
		log("Shutting down");
		gatewayClient.close();
		if (nodeWs.readyState === 1) nodeWs.close();
		process.exit(0);
	});
}

main().catch((err) => {
	console.error("[feishu-node]", err);
	process.exit(1);
});
