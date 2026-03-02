/**
 * 从环境变量读取配置。建议在项目根或本目录下建 .env，勿提交敏感信息。
 */
export type FeishuAppConfig = {
	appId: string;
	appSecret: string;
	gatewayWsUrl: string;
	domain: "feishu" | "lark";
	connectorId: string;
	connectorDisplayName?: string;
};

const DEFAULT_GATEWAY_WS = "ws://127.0.0.1:9347";
const DEFAULT_CONNECTOR_ID = "feishu";
const DEFAULT_NODE_ID = "feishu-1";

export function loadConfig(): FeishuAppConfig {
	const appId = process.env.FEISHU_APP_ID?.trim();
	const appSecret = process.env.FEISHU_APP_SECRET?.trim();
	if (!appId || !appSecret) {
		throw new Error("Missing FEISHU_APP_ID or FEISHU_APP_SECRET. Set them in .env or environment.");
	}
	const gatewayWsUrl = process.env.GATEWAY_WS_URL?.trim() || process.env.GATEWAY_URL?.trim() || DEFAULT_GATEWAY_WS;
	const domain = process.env.FEISHU_DOMAIN?.trim() === "lark" ? "lark" : "feishu";
	const connectorId = process.env.CONNECTOR_ID?.trim() || DEFAULT_CONNECTOR_ID;
	const connectorDisplayName = process.env.CONNECTOR_DISPLAY_NAME?.trim() || undefined;
	return { appId, appSecret, gatewayWsUrl, domain, connectorId, connectorDisplayName };
}

export function getNodeId(): string {
	return process.env.FEISHU_NODE_ID?.trim() || DEFAULT_NODE_ID;
}
