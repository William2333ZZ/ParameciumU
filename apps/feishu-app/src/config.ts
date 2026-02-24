/**
 * 从环境变量读取配置。建议在项目根或本目录下建 .env，勿提交敏感信息。
 */
export type FeishuAppConfig = {
  /** 飞书应用 App ID */
  appId: string;
  /** 飞书应用 App Secret */
  appSecret: string;
  /** Gateway WebSocket 地址，如 ws://127.0.0.1:18789 */
  gatewayWsUrl: string;
  /** 飞书域名：feishu | lark，默认 feishu */
  domain: "feishu" | "lark";
  /** 该实例在 Gateway 中的 connectorId，多飞书时区分，如 feishu、feishu_team_b */
  connectorId: string;
  /** 可选展示名，用于 Control UI（如飞书应用名，可设 CONNECTOR_DISPLAY_NAME 或由飞书 API 获取） */
  connectorDisplayName?: string;
};

const DEFAULT_GATEWAY_WS = "ws://127.0.0.1:18789";
const DEFAULT_CONNECTOR_ID = "feishu";

export function loadConfig(): FeishuAppConfig {
  const appId = process.env.FEISHU_APP_ID?.trim();
  const appSecret = process.env.FEISHU_APP_SECRET?.trim();
  if (!appId || !appSecret) {
    throw new Error(
      "Missing FEISHU_APP_ID or FEISHU_APP_SECRET. Set them in .env or environment.",
    );
  }
  const gatewayWsUrl = process.env.GATEWAY_WS_URL?.trim() || DEFAULT_GATEWAY_WS;
  const domain = process.env.FEISHU_DOMAIN?.trim() === "lark" ? "lark" : "feishu";
  const connectorId = process.env.CONNECTOR_ID?.trim() || DEFAULT_CONNECTOR_ID;
  const connectorDisplayName = process.env.CONNECTOR_DISPLAY_NAME?.trim() || undefined;
  return { appId, appSecret, gatewayWsUrl, domain, connectorId, connectorDisplayName };
}
