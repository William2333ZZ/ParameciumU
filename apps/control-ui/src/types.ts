/** Gateway RPC 请求/响应与 payload 类型（与 @monou/gateway 协议一致） */

export type GatewayRequest = {
  method: string;
  params?: Record<string, unknown>;
  id?: string;
};

export type GatewayResponse = {
  id?: string;
  ok: boolean;
  payload?: unknown;
  error?: { code: number; message: string };
};

export type AgentItem = { agentId: string; deviceId?: string; connId: string; online: boolean; lastHeartbeatAt?: number };
export type NodeAgent = { agentId: string; connId: string; lastHeartbeatAt?: number };
export type NodeItem = {
  nodeId: string;
  deviceId?: string;
  connId: string;
  agents: NodeAgent[];
  /** connect 时声明的能力，如 ["browser"]，用于筛 Browser 节点 */
  capabilities?: string[];
  /** Browser 节点上报的 noVNC 端口，Control UI 通过 /vnc/:port 代理（多节点各用各口） */
  vncPort?: number;
};

/** 已连接的接入（如飞书 App 长连后） */
export type ConnectorItem = {
  connectorId: string;
  connId: string;
  online: boolean;
  /** 可选展示名（connect 时上报，如飞书应用名） */
  displayName?: string;
};

export type CronJob = {
  id: string;
  name?: string;
  enabled?: boolean;
  schedule?: { kind: string; everyMs?: number };
  nextRunAtMs?: number;
};

export type ConnectorMapping = {
  id: string;
  connectorId: string;
  channelId?: string;
  agentId: string;
  nodeId?: string;
  deviceId?: string;
};

/** sessions.list 单项（与 Gateway 协议一致） */
export type SessionPreview = {
  key: string;
  sessionId: string;
  updatedAt: number;
  displayName?: string;
  channel?: string;
  contextTokens?: number;
  totalTokens?: number;
  model?: string;
  thinkingLevel?: string;
  sendPolicy?: string;
};
