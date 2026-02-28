/**
 * 通过飞书 REST API 发送文本到指定会话（回复或新消息）。
 */
import * as Lark from "@larksuiteoapi/node-sdk";
import type { FeishuAppConfig } from "./config.js";

function getClient(config: FeishuAppConfig): Lark.Client {
	const domain = config.domain === "lark" ? Lark.Domain.Lark : Lark.Domain.Feishu;
	return new Lark.Client({
		appId: config.appId,
		appSecret: config.appSecret,
		appType: Lark.AppType.SelfBuild,
		domain,
	});
}

/**
 * 发送文本到 chat_id（群或单聊）。若提供 messageId 则作为回复。
 */
export async function sendMessage(
	config: FeishuAppConfig,
	opts: {
		receiveId: string;
		receiveIdType: "chat_id" | "open_id";
		text: string;
		replyToMessageId?: string;
	},
): Promise<{ messageId?: string }> {
	const client = getClient(config);
	const content = JSON.stringify({
		zh_cn: {
			content: [[{ tag: "text", text: opts.text }]],
		},
	});
	if (opts.replyToMessageId) {
		const res = await client.im.message.reply({
			path: { message_id: opts.replyToMessageId },
			data: { content, msg_type: "post" },
		});
		if (res.code !== 0) {
			throw new Error(`Feishu reply failed: ${res.msg ?? res.code}`);
		}
		return { messageId: (res.data as { message_id?: string })?.message_id };
	}
	const res = await client.im.message.create({
		params: { receive_id_type: opts.receiveIdType },
		data: {
			receive_id: opts.receiveId,
			content,
			msg_type: "post",
		},
	});
	if (res.code !== 0) {
		throw new Error(`Feishu send failed: ${res.msg ?? res.code}`);
	}
	return { messageId: (res.data as { message_id?: string })?.message_id };
}
