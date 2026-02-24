/**
 * @monou/gateway — 协议类型与客户端（callGateway）
 */

export type {
  GatewayRequest,
  GatewayResponse,
  GatewayEvent,
  ErrorShape,
  ConnectIdentity,
  GatewayMethod,
  GatewayEventName,
} from "./protocol.js";
export {
  GATEWAY_METHODS,
  GATEWAY_EVENTS,
} from "./protocol.js";
export { callGateway } from "./client.js";
export type { CallGatewayOptions } from "./client.js";
