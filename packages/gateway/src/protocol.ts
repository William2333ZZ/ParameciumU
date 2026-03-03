/**
 * monoU Gateway 协议（与 OpenClaw 兼容子集）
 * - 请求: { method, params?, id? }
 * - 响应: { id?, ok, payload?, error? }
 * - 服务端事件: { event, payload }
 * - connect 身份: role, agentId?, deviceId?, capabilities?
 */

export type GatewayRequest = {
	method: string;
	params?: Record<string, unknown>;
	id?: string;
};

export type ErrorShape = {
	code: number;
	message: string;
};

export type GatewayResponse = {
	id?: string;
	ok: boolean;
	payload?: unknown;
	error?: ErrorShape;
	meta?: Record<string, unknown>;
};

export type GatewayEvent = {
	event: string;
	payload: unknown;
};

/** connect 时客户端声明 */
export type ConnectIdentity = {
	role?: "operator" | "agent" | "node" | "client" | "connector";
	agentId?: string;
	deviceId?: string;
	/** 当 role 为 connector 时必填，如 feishu */
	connectorId?: string;
	/** 当 role 为 connector 时可选，用于 UI 展示（如从飞书获取的应用名或自定义名） */
	connectorDisplayName?: string;
	capabilities?: string[];
	/** 当 role 为 node 且提供 VNC 时可选：noVNC 监听端口（Control UI 通过 /vnc/:port 代理到该端口，支持多节点） */
	vncPort?: number;
};

/** 支持的方法名（与 OpenClaw 一致子集 + connector 映射） */
export const GATEWAY_METHODS = [
	"connect",
	"health",
	"status",
	"cron.list",
	"cron.status",
	"cron.add",
	"cron.update",
	"cron.remove",
	"cron.run",
	"cron.runs",
	"agents.list",
	"sessions.list",
	"sessions.preview",
	"sessions.delete",
	"sessions.getTree",
	"sessions.navigate",
	"sessions.fork",
	"agent",
	"agent.heartbeat",
	"agent.wait",
	"chat.history",
	"chat.send",
	"chat.abort",
	"skills.status",
	"sessions.patch",
	"node.list",
	"node.invoke",
	"node.invoke.result",
	"node.invoke.progress",
	"file.upload",
	"agent.file.upload.result",
	"connector.mapping.list",
	"connector.mapping.add",
	"connector.mapping.remove",
	"connector.mapping.resolve",
	"connector.message.inbound",
	"connector.message.push",
] as const;

export type GatewayMethod = (typeof GATEWAY_METHODS)[number];

export const GATEWAY_EVENTS = [
	"health",
	"cron",
	"presence",
	"agent",
	"agent.run.started",
	"agent.run.chunk",
	"agent.run.done",
	"agent.run.progress",
	"node.invoke.request",
	"agent.file.upload",
	"connector.message.push",
] as const;
export type GatewayEventName = (typeof GATEWAY_EVENTS)[number];
