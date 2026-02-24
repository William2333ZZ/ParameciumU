/**
 * 飞书 WebSocket 客户端：订阅 im.message.receive_v1，解析正文后交给 bridge 并回发。
 */
import * as Lark from "@larksuiteoapi/node-sdk";
import type { FeishuAppConfig } from "./config.js";
import type { GatewayRequestFn } from "./gateway-bridge.js";
import { sendInboundToGateway } from "./gateway-bridge.js";
import { sendMessage } from "./send.js";

export type FeishuMessageEvent = {
  sender: { sender_id: { open_id?: string; user_id?: string } };
  message: {
    message_id: string;
    chat_id: string;
    chat_type: "p2p" | "group";
    message_type: string;
    content: string;
  };
};

function parseTextContent(content: string, messageType: string): string {
  try {
    const parsed = JSON.parse(content);
    if (messageType === "text" && typeof parsed.text === "string") {
      return parsed.text.trim();
    }
    if (messageType === "post") {
      const blocks = parsed.content ?? [];
      let text = "";
      for (const row of blocks) {
        if (Array.isArray(row)) {
          for (const el of row) {
            if (el?.tag === "text" && el.text) text += el.text;
            if (el?.tag === "at" && el.user_name) text += `@${el.user_name}`;
          }
          text += "\n";
        }
      }
      return text.trim() || "[富文本]";
    }
  } catch {
    // ignore
  }
  return content || "[非文本消息]";
}

export function createFeishuWSClient(config: FeishuAppConfig): Lark.WSClient {
  const domain =
    config.domain === "lark" ? Lark.Domain.Lark : Lark.Domain.Feishu;
  return new Lark.WSClient({
    appId: config.appId,
    appSecret: config.appSecret,
    domain,
    loggerLevel: Lark.LoggerLevel.warn,
  });
}

export function createEventDispatcher(config: FeishuAppConfig): Lark.EventDispatcher {
  return new Lark.EventDispatcher({});
}

export function registerInboundHandler(
  dispatcher: Lark.EventDispatcher,
  config: FeishuAppConfig,
  log: (msg: string) => void,
  gatewayRequest: GatewayRequestFn,
): void {
  dispatcher.register({
    "im.message.receive_v1": async (data: unknown) => {
    log(`[feishu] event received (raw keys: ${typeof data === "object" && data !== null ? Object.keys(data as object).join(",") : "null"})`);
    const raw = data as Record<string, unknown>;
    const event = (raw?.event ?? raw?.data ?? raw) as FeishuMessageEvent;
    const message = event?.message;
    const sender = event?.sender;
    if (!message?.chat_id) {
      log(`[feishu] skip: no message.chat_id in event`);
      return;
    }
    const chatId = message.chat_id;
    const messageId = message.message_id;
    const senderOpenId = sender?.sender_id?.open_id ?? sender?.sender_id?.user_id ?? "";
    const messageType = message.message_type ?? "text";
    const text = parseTextContent(message.content, messageType);
    if (!text || text === "[非文本消息]") {
      log(`[feishu] skip non-text message chat=${chatId} type=${messageType} content_sample=${String(message.content).slice(0, 80)}`);
      return;
    }
    log(`[feishu] inbound chat=${chatId} sender=${senderOpenId} text=${text.slice(0, 80)}`);
    try {
      const result = await sendInboundToGateway(gatewayRequest, {
        connectorId: config.connectorId,
        channelId: message.chat_type === "group" ? chatId : undefined,
        chatId,
        senderId: senderOpenId,
        text,
        messageId,
      });
      const replyText = result?.replyText?.trim();
      if (!replyText) {
        log(`[feishu] no reply from gateway result=${JSON.stringify(result ?? {}).slice(0, 200)}`);
        return;
      }
      log(`[feishu] sending reply to Feishu chat=${chatId} len=${replyText.length}`);
      await sendMessage(config, {
        receiveId: chatId,
        receiveIdType: "chat_id",
        text: replyText,
        replyToMessageId: messageId,
      });
      log(`[feishu] reply sent chat=${chatId}`);
    } catch (err) {
      const e = err as Error & { response?: { data?: unknown } };
      log(`[feishu] error: ${e.message}${e.response?.data ? ` response=${JSON.stringify(e.response.data).slice(0, 300)}` : ""}`);
    }
    },
  });
}
