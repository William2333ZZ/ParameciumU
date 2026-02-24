/**
 * monoU 飞书 App：长连 Gateway 为 Connector（Control UI 可见）→ 连飞书 WebSocket 收消息 → 调 connector.message.inbound → 把回复发回飞书；
 * 支持接收 connector.message.push 主动推送并发到飞书对应会话。
 */
import "dotenv/config";
import { loadConfig } from "./config.js";
import { createGatewayConnectorClient } from "./gateway-connector-client.js";
import { createFeishuWSClient, createEventDispatcher, registerInboundHandler } from "./feishu-client.js";
import { sendMessage } from "./send.js";

async function main() {
  const config = loadConfig();
  const log = (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`);
  log(`Feishu App starting (connectorId=${config.connectorId})`);
  log(`Gateway: ${config.gatewayWsUrl}`);

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
  const gatewayRequest: (method: string, params?: Record<string, unknown>) => Promise<unknown> =
    (method, params) => gatewayClient.request(method, params);

  const wsClient = createFeishuWSClient(config);
  const eventDispatcher = createEventDispatcher(config);
  registerInboundHandler(eventDispatcher, config, log, gatewayRequest);

  wsClient.start({ eventDispatcher }).then(() => {
    log("Feishu WebSocket connected");
  }).catch((err) => {
    log(`Feishu WebSocket error: ${String(err)}`);
    process.exit(1);
  });

  process.on("SIGINT", () => {
    log("Shutting down");
    gatewayClient.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("[feishu-app]", err);
  process.exit(1);
});
