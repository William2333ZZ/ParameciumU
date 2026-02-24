/**
 * Gateway 运行时上下文：连接注册表、身份、待决 node.invoke、Connector 映射
 */

import type { ConnectIdentity } from "@monou/gateway";
import type { CronStore } from "@monou/cron";

export type ConnectionEntry = {
  connId: string;
  ws: import("ws").WebSocket;
  identity?: ConnectIdentity;
  connectedAt: number;
  /** 若启用认证，首条 connect 通过后为 true */
  authenticated?: boolean;
  /** connect 时可选绑定：该连接默认使用的 sessionKey，后续 agent/chat.history 未传 sessionKey 时用此值 */
  sessionKey?: string;
  /** Agent 最近一次执行心跳任务的时间戳（由 agent.heartbeat 上报），用于 UI 显示「最近活跃」 */
  lastHeartbeatAt?: number;
};

/** 本机默认 agent 的 deviceId，与远程 Node 区分；取 127.0.0.1 去点形式，便于识别为本地 */
export const DEFAULT_LOCAL_DEVICE_ID = "1270000001";

/** 本机默认 agent 的 id：与存放 agent 信息的文件夹同名，默认即 .u（其下 skill、cron、chat 等） */
export const DEFAULT_LOCAL_AGENT_ID = ".u";

/** 单条 Connector/Channel 转发映射：选择用哪个 Agent、在哪个 Node 上执行 */
export type ConnectorMapping = {
  id: string;
  connectorId: string;
  channelId?: string;
  agentId: string;
  nodeId?: string;
  deviceId?: string;
};

export type GatewayContext = {
  cronStore: CronStore;
  rootDir: string;
  startedAt: number;
  /** Session store 文件路径（.gateway/sessions/sessions.json） */
  sessionStorePath: string;
  /** 默认 session 的 transcript 路径（.gateway/sessions/transcripts/ 下），用于 resolveSession */
  mainTranscriptPath: string;
  /** 连接表：connId -> { ws, identity?, sessionKey? } */
  connections: Map<string, ConnectionEntry>;
  /** node.invoke 请求 id -> resolve(result) */
  pendingInvokes: Map<string, (result: unknown) => void>;
  /** Connector 转发映射：入站/派发时 resolve 得到 agentId + nodeId（可持久化到 .gateway/mappings.json） */
  connectorMappings: ConnectorMapping[];
  /** 将 connectorMappings 写回磁盘（.gateway），由 index 在启动时注入 */
  persistConnectorMappings?: () => Promise<void>;
  /** 生成唯一 connId */
  nextConnId: () => string;
  /** 生成唯一 invoke id */
  nextInvokeId: () => string;
  /** 生成唯一 mapping id */
  nextMappingId: () => string;
  /** agent 运行 id，用于 agent.wait / chat.abort */
  nextRunId: () => string;
  /** runId -> { resolve, reject }，agent 完成后 resolve */
  inFlightAgentRuns: Map<string, { resolve: (r: unknown) => void; reject: (e: Error) => void }>;
  /** runId -> Promise<result>，供 agent.wait 等待 */
  runIdToPromise: Map<string, Promise<{ text: string; toolCalls?: Array<{ name: string; arguments?: string }> }>>;
  /** runId -> AbortController，供 chat.abort 中止 */
  runIdToAbort: Map<string, AbortController>;
  /** 广播事件（由 index 在创建 wss 后注入） */
  broadcast?: (event: string, payload: unknown) => void;
  /** 向指定 connector 推送事件（仅发给 identity.connectorId 匹配的连接） */
  pushToConnector?: (connectorId: string, event: string, payload: unknown) => void;
  /** 按 sessionKey 的队列状态（入队、排水、collect）；未设置则不启用队列 */
  sessionQueue?: import("./queue.js").SessionQueueState;
  /** 跑一轮 agent（由 index 注入，可带 gatewayInvoke 供 message/sessions skill 使用） */
  runAgent?: (
    rootDir: string,
    message: string,
    opts?: {
      agentDir?: string;
      transcriptPath?: string;
      signal?: AbortSignal;
      onTextChunk?: (text: string) => void;
    },
  ) => Promise<{ text: string; toolCalls?: Array<{ name: string; arguments?: string }> }>;
};

export function createGatewayContext(opts: {
  cronStore: CronStore;
  rootDir: string;
  /** Session store 文件路径 */
  sessionStorePath: string;
  /** 默认 session 的 transcript 路径（.gateway 下） */
  mainTranscriptPath: string;
  /** 从 .gateway/mappings.json 加载的初始映射（若存在） */
  initialConnectorMappings?: ConnectorMapping[];
}): GatewayContext {
  let connSeq = 0;
  let invokeSeq = 0;
  let mappingSeq = 0;
  let runSeq = 0;
  return {
    cronStore: opts.cronStore,
    rootDir: opts.rootDir,
    sessionStorePath: opts.sessionStorePath,
    mainTranscriptPath: opts.mainTranscriptPath,
    startedAt: Date.now(),
    connections: new Map(),
    pendingInvokes: new Map(),
    connectorMappings: opts.initialConnectorMappings ?? [],
    nextConnId: () => `conn-${++connSeq}-${Date.now()}`,
    nextInvokeId: () => `inv-${++invokeSeq}-${Date.now()}`,
    nextMappingId: () => `mapping-${++mappingSeq}-${Date.now()}`,
    nextRunId: () => `run-${++runSeq}-${Date.now()}`,
    inFlightAgentRuns: new Map(),
    runIdToPromise: new Map(),
    runIdToAbort: new Map(),
  };
}

export function getAgentsFromConnections(connections: Map<string, ConnectionEntry>): Array<{ agentId: string; deviceId?: string; connId: string; online: boolean; lastHeartbeatAt?: number }> {
  const list: Array<{ agentId: string; deviceId?: string; connId: string; online: boolean; lastHeartbeatAt?: number }> = [];
  for (const [connId, entry] of connections) {
    if (entry.identity?.role === "agent" && entry.identity?.agentId && entry.ws.readyState === 1) {
      list.push({
        agentId: entry.identity.agentId,
        deviceId: entry.identity.deviceId,
        connId,
        online: true,
        lastHeartbeatAt: entry.lastHeartbeatAt,
      });
    }
  }
  /** 无远程 agent 时，默认列出本机 .u 目录对应的 agent（由 Gateway 进程内 runAgent(rootDir) 执行），agentId 与文件夹同名 */
  if (list.length === 0) list.push({ agentId: DEFAULT_LOCAL_AGENT_ID, deviceId: DEFAULT_LOCAL_DEVICE_ID, connId: "", online: true });
  return list;
}

/** 按 deviceId 聚合的 Node：一个设备一个 Node，其上可有多 Agent（多连接） */
export type NodeEntry = {
  nodeId: string;
  deviceId?: string;
  /** 该 Node 上的 agentId 列表（role=agent 的连接） */
  agents: Array<{ agentId: string; connId: string }>;
  /** 用于 node.invoke 的主连接：优先 role=node，否则该 deviceId 下第一个 agent 连接 */
  connId: string;
  /** connect 时声明的能力，如 ["sandbox"]（Sandbox Node 方案 B） */
  capabilities?: string[];
};

export function getNodesFromConnections(connections: Map<string, ConnectionEntry>): NodeEntry[] {
  const byDevice = new Map<
    string,
    {
      connIds: string[];
      agentIds: Array<{ agentId: string; connId: string }>;
      nodeConnId?: string;
      capabilities?: string[];
    }
  >();

  for (const [connId, entry] of connections) {
    if (entry.ws.readyState !== 1) continue;
    const id = entry.identity;
    const deviceId = id?.deviceId ?? id?.agentId ?? connId;
    const caps = Array.isArray(id?.capabilities) ? (id.capabilities as string[]) : undefined;

    if (id?.role === "node") {
      let slot = byDevice.get(deviceId);
      if (!slot) {
        slot = { connIds: [], agentIds: [], nodeConnId: connId, capabilities: caps };
        byDevice.set(deviceId, slot);
      }
      slot.connIds.push(connId);
      if (!slot.nodeConnId) slot.nodeConnId = connId;
      if (caps?.length) slot.capabilities = caps;
    } else if (id?.role === "agent" && id?.agentId) {
      let slot = byDevice.get(deviceId);
      if (!slot) {
        slot = { connIds: [], agentIds: [], nodeConnId: undefined, capabilities: caps };
        byDevice.set(deviceId, slot);
      }
      slot.connIds.push(connId);
      slot.agentIds.push({ agentId: id.agentId, connId });
      if (!slot.nodeConnId) slot.nodeConnId = connId;
      if (caps?.length) slot.capabilities = caps;
    }
  }

  const list: NodeEntry[] = [];
  for (const [deviceId, slot] of byDevice) {
    const connId = slot.nodeConnId ?? slot.connIds[0];
    if (!connId) continue;
    list.push({
      nodeId: deviceId,
      deviceId: deviceId,
      agents: slot.agentIds,
      connId,
      capabilities: slot.capabilities,
    });
  }
  return list;
}

/** 已连接的 Connector（飞书等 App 长连后出现在此列表） */
export type ConnectorEntry = {
  connectorId: string;
  connId: string;
  online: boolean;
  /** 可选展示名（connect 时由 connector 上报，如飞书应用名） */
  displayName?: string;
};

export function getConnectorsFromConnections(connections: Map<string, ConnectionEntry>): ConnectorEntry[] {
  const list: ConnectorEntry[] = [];
  for (const [connId, entry] of connections) {
    if (entry.identity?.role !== "connector" || !entry.identity?.connectorId) continue;
    if (entry.ws.readyState !== 1) continue;
    const id = entry.identity as { connectorDisplayName?: string };
    list.push({
      connectorId: entry.identity.connectorId,
      connId,
      online: true,
      displayName: typeof id.connectorDisplayName === "string" && id.connectorDisplayName.trim() ? id.connectorDisplayName.trim() : undefined,
    });
  }
  return list;
}
