/**
 * @monou/gateway — 协议类型与客户端（callGateway）
 */

export type { CallGatewayOptions } from "./client.js";
export { callGateway } from "./client.js";
export type {
	ConnectIdentity,
	ErrorShape,
	GatewayEvent,
	GatewayEventName,
	GatewayMethod,
	GatewayRequest,
	GatewayResponse,
} from "./protocol.js";
export {
	GATEWAY_EVENTS,
	GATEWAY_METHODS,
} from "./protocol.js";
