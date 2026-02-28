/**
 * 将飞书入站消息发给 Gateway connector.message.inbound，取回回复文本。
 * 使用长连 Connector 客户端的 request 方法（Control UI 中会显示为飞书节点）。
 */
export type InboundParams = {
	connectorId: string;
	channelId?: string;
	chatId: string;
	senderId?: string;
	text: string;
	messageId?: string;
};

export type InboundResult = { replyText?: string; runId?: string };

export type GatewayRequestFn = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

export async function sendInboundToGateway(request: GatewayRequestFn, params: InboundParams): Promise<InboundResult> {
	const payload = await request("connector.message.inbound", {
		connectorId: params.connectorId,
		channelId: params.channelId,
		chatId: params.chatId,
		senderId: params.senderId,
		text: params.text,
		messageId: params.messageId,
	});
	return (payload as InboundResult) ?? {};
}
