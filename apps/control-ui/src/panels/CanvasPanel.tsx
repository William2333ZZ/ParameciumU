import { useCallback, useEffect, useState, createContext, useContext } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { gatewayClient } from "../gateway-client";
import type { NodeItem, NodeAgent, ConnectorItem } from "../types";

/** 根据 lastHeartbeatAt 显示「最近活跃」或「未上报心跳」 */
function AgentHeartbeatHint({ lastHeartbeatAt }: { lastHeartbeatAt?: number }) {
  if (lastHeartbeatAt == null) {
    return <span className="muted" style={{ fontSize: "0.7rem" }}>未上报心跳</span>;
  }
  const sec = Math.floor((Date.now() - lastHeartbeatAt) / 1000);
  const label = sec < 60 ? "刚刚" : sec < 3600 ? `${Math.floor(sec / 60)} 分钟前` : sec < 86400 ? `${Math.floor(sec / 3600)} 小时前` : `${Math.floor(sec / 86400)} 天前`;
  return <span className="muted" style={{ fontSize: "0.7rem" }}>最近活跃 {label}</span>;
}

const LOCAL_DEVICE_IDS = ["1270000001", "local"];
const NODE_WIDTH = 200;
const GATEWAY_Y = 40;
const RADIUS = 240;
const CENTER_Y = 180;
const MAX_DEVICE_NAME_LEN = 20;
const CONNECTOR_GAP = 220;

/** 设备名展示：取 hostname 第一段（去掉 .local 等），过长则截断加省略号，避免框溢出 */
function shortDeviceName(name: string): string {
  if (!name) return "—";
  const first = name.split(".")[0] ?? name;
  if (first.length <= MAX_DEVICE_NAME_LEN) return first;
  return `${first.slice(0, MAX_DEVICE_NAME_LEN - 1)}…`;
}

function nodeDisplayName(n: NodeItem): string {
  if (n.deviceId && LOCAL_DEVICE_IDS.includes(n.deviceId)) return "本机";
  return shortDeviceName(n.nodeId);
}

const GATEWAY_NODE_WIDTH = 140;

/** 环形排布：Gateway 在上方居中，Node 在下方半圆弧上，留出间距 */
function buildPositions(count: number): { gateway: { x: number; y: number }; nodes: { x: number; y: number }[] } {
  const gateway = { x: -GATEWAY_NODE_WIDTH / 2, y: GATEWAY_Y };
  if (count === 0) return { gateway, nodes: [] };
  const nodes: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i++) {
    const angle = Math.PI * 0.5 + (count === 1 ? 0 : (i / (count - 1)) * Math.PI);
    nodes.push({
      x: RADIUS * Math.cos(angle) - NODE_WIDTH / 2,
      y: CENTER_Y + RADIUS * Math.sin(angle) - 28,
    });
  }
  return { gateway, nodes };
}

type ClusterContextValue = { onOpenChat?: (agentId: string) => void };
const ClusterContext = createContext<ClusterContextValue>({});

function GatewayNode(props: NodeProps) {
  const data = props.data as { label: string };
  return (
    <div className="canvas-gateway-node" title="Gateway 中枢">
      <Handle type="target" position={Position.Top} id="gateway-in-top" className="canvas-handle" />
      <Handle type="source" position={Position.Top} id="gateway-out-top" className="canvas-handle" />
      <span className="canvas-gateway-node-label">{data.label}</span>
      <Handle type="source" position={Position.Bottom} id="gateway-out" className="canvas-handle" />
    </div>
  );
}

function ConnectorNode(props: NodeProps) {
  const data = props.data as { connectorId: string; displayName?: string; online: boolean };
  const title = data.displayName ?? data.connectorId;
  return (
    <div className="canvas-device-node canvas-connector-node" title={`接入: ${title}`}>
      <div className="canvas-device-node-title">{title}</div>
      <div className="muted" style={{ fontSize: "0.75rem" }}>{data.online ? "已连接" : "—"}</div>
      <Handle type="target" position={Position.Bottom} id="connector-in" className="canvas-handle" />
    </div>
  );
}

function DeviceNode(props: NodeProps) {
  const { onOpenChat } = useContext(ClusterContext);
  const data = props.data as { nodeItem: NodeItem; title: string };
  const nodeItem = data.nodeItem;
  const title = data.title;
  const agents = nodeItem?.agents ?? [];

  return (
    <div className="canvas-device-node" title={nodeItem?.deviceId ?? title}>
      <Handle type="target" position={Position.Top} id="device-in" className="canvas-handle" />
      <div className="canvas-device-node-title">{title}</div>
      <ul className="canvas-device-node-agents">
        {agents.length === 0 ? (
          <li className="muted">— 无 Agent</li>
        ) : (
          agents.map((a: NodeAgent, i: number) => (
            <li key={a.connId ? `${a.agentId}-${a.connId}` : `${a.agentId}-${i}`} className="canvas-device-agent-row">
              <span className="canvas-device-agent-id">{a.agentId}</span>
              <AgentHeartbeatHint lastHeartbeatAt={a.lastHeartbeatAt} />
              {onOpenChat && (
                <button
                  type="button"
                  className="chat-link-btn canvas-device-chat-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenChat(a.agentId);
                  }}
                >
                  对话
                </button>
              )}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

const nodeTypes: NodeTypes = { gateway: GatewayNode, device: DeviceNode, connector: ConnectorNode };

const CONNECTOR_ABOVE_Y = -88;

function buildGraph(nodes: NodeItem[], connectors: ConnectorItem[]): { nodes: Node[]; edges: Edge[] } {
  const graphNodes: Node[] = [];
  const graphEdges: Edge[] = [];
  const { gateway: gwPos, nodes: posList } = buildPositions(nodes.length);

  graphNodes.push({
    id: "gateway",
    type: "gateway",
    position: { x: gwPos.x, y: gwPos.y },
    data: { label: "Gateway" },
    draggable: false,
    sourcePosition: Position.Bottom,
    targetPosition: Position.Top,
    style: { width: GATEWAY_NODE_WIDTH, minHeight: 48 },
  });

  /* 接入节点在 Gateway 上方横向排开 */
  connectors.forEach((c, i) => {
    const id = `connector-${c.connectorId}`;
    const totalConn = connectors.length;
    const startX = totalConn === 1 ? gwPos.x : gwPos.x - ((totalConn - 1) * CONNECTOR_GAP) / 2;
    graphNodes.push({
      id,
      type: "connector",
      position: {
        x: startX + i * CONNECTOR_GAP - NODE_WIDTH / 2,
        y: GATEWAY_Y + CONNECTOR_ABOVE_Y,
      },
      data: { connectorId: c.connectorId, displayName: c.displayName, online: c.online },
      draggable: true,
      targetPosition: Position.Bottom,
      style: { width: NODE_WIDTH, minHeight: 52 },
    });
    graphEdges.push({
      id: `e-gateway-${id}`,
      source: "gateway",
      target: id,
      sourceHandle: "gateway-out-top",
      targetHandle: "connector-in",
    });
  });

  nodes.forEach((n, i) => {
    const id = `node-${n.nodeId}`;
    const pos = posList[i] ?? { x: 0, y: CENTER_Y };
    graphNodes.push({
      id,
      type: "device",
      position: { x: pos.x, y: pos.y },
      data: {
        nodeItem: n,
        title: nodeDisplayName(n),
      },
      draggable: true,
      targetPosition: Position.Top,
      style: { width: NODE_WIDTH, minHeight: 52 },
    });
    graphEdges.push({
      id: `e-gateway-${id}`,
      source: "gateway",
      target: id,
      sourceHandle: "gateway-out",
      targetHandle: "device-in",
    });
  });

  return { nodes: graphNodes, edges: graphEdges };
}

/** 不再在前端写死 fallback：节点列表以 Gateway 返回的 node.list 为准，避免覆盖 run2_agent / fulltest_agent / e2e-test 等实际节点 */

const CANVAS_STORAGE_KEY = "monou-control-ui-canvas";

type CanvasSavedState = {
  viewport?: { x: number; y: number; zoom: number };
  nodePositions?: Record<string, { x: number; y: number }>;
};

function loadCanvasState(): CanvasSavedState | null {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(CANVAS_STORAGE_KEY) : null;
    if (!raw) return null;
    return JSON.parse(raw) as CanvasSavedState;
  } catch {
    return null;
  }
}

function saveCanvasState(state: CanvasSavedState): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(CANVAS_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

const ADD_NODE_CMD =
  "AGENT_ID=my_agent GATEWAY_URL=ws://127.0.0.1:9347 ./.first_paramecium/skills/agent-creator/scripts/create-and-connect.sh";

function CanvasInner({
  active,
  onOpenChat,
}: {
  active?: boolean;
  onOpenChat?: (agentId: string) => void;
}) {
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showAddNode, setShowAddNode] = useState(false);
  const [copyDone, setCopyDone] = useState(false);
  const [nodesState, setNodesState, onNodesChange] = useNodesState<Node>([]);
  const [edgesState, setEdgesState, onEdgesChange] = useEdgesState<Edge>([]);
  const { fitView, getViewport, setViewport } = useReactFlow();

  const [connectors, setConnectors] = useState<ConnectorItem[]>([]);

  const load = useCallback(() => {
    setErr(null);
    setLoading(true);
    gatewayClient
      .request<{ nodes: NodeItem[]; connectors?: ConnectorItem[] }>("node.list")
      .then((nr) => {
        const payload = nr.ok && nr.payload ? (nr.payload as { nodes?: NodeItem[]; connectors?: ConnectorItem[] }) : {};
        const list = Array.isArray(payload.nodes) ? payload.nodes : [];
        const connList = Array.isArray(payload.connectors) ? payload.connectors : [];
        setNodes(list);
        setConnectors(connList);
      })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (active) load();
  }, [active, load]);

  // 离开画布时保存 viewport 与节点位置
  useEffect(() => {
    if (active) return;
    try {
      const vp = getViewport();
      const nodePositions: Record<string, { x: number; y: number }> = {};
      nodesState.forEach((nd) => {
        nodePositions[nd.id] = nd.position;
      });
      saveCanvasState({ viewport: vp, nodePositions });
    } catch {
      // ignore
    }
  }, [active, getViewport, nodesState]);

  useEffect(() => {
    const { nodes: n, edges: e } = buildGraph(nodes, connectors);
    const saved = loadCanvasState();
    if (saved?.nodePositions) {
      n.forEach((nd) => {
        const pos = saved.nodePositions?.[nd.id];
        if (pos) nd.position = pos;
      });
    }
    setNodesState(n);
    setEdgesState(e);
  }, [nodes, connectors, setNodesState, setEdgesState]);

  // 恢复 viewport（在节点渲染后）
  useEffect(() => {
    if (!active || nodesState.length === 0) return;
    const saved = loadCanvasState();
    if (!saved?.viewport) return;
    const id = requestAnimationFrame(() => {
      try {
        setViewport(saved.viewport!);
      } catch {
        // ignore
      }
    });
    return () => cancelAnimationFrame(id);
  }, [active, setViewport, nodesState.length]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "r" || e.key === "R") {
        load();
        return;
      }
      if (e.key === "f" || e.key === "F") {
        fitView?.({ padding: 0.25 });
        return;
      }
      if (e.key === "n" || e.key === "N" || e.key === "+") {
        setShowAddNode((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, load, fitView]);

  const copyCommand = useCallback(() => {
    navigator.clipboard.writeText(ADD_NODE_CMD).then(() => {
      setCopyDone(true);
      setTimeout(() => setCopyDone(false), 2000);
    });
  }, []);

  if (loading) return <p className="loading">加载中…</p>;
  if (err) return <p className="error">加载失败: {err}</p>;

  return (
    <ClusterContext.Provider value={{ onOpenChat }}>
      <div className="canvas-panel">
        <div className="canvas-toolbar">
          <span className="canvas-toolbar-hint">
            Agent 智能集群：Gateway → 节点（设备）→ Agent。快捷键 R 刷新 · F 适应视图 · N 添加节点说明
          </span>
          <div className="canvas-toolbar-actions">
            <button type="button" className="canvas-refresh-btn" onClick={() => load()}>
              刷新
            </button>
            <button
              type="button"
              className="canvas-refresh-btn canvas-add-node-btn"
              onClick={() => setShowAddNode((v) => !v)}
            >
              + 添加节点
            </button>
          </div>
        </div>

        {showAddNode && (
          <div className="canvas-add-node-card card">
            <h4>添加节点 / Agent</h4>
            <p className="muted" style={{ fontSize: "0.85rem", marginBottom: "0.75rem" }}>
              节点由「连接」产生，无 node.add。在本机或远程启动 agent-client 连上 Gateway 后，在此点击「刷新」即可看到新节点。
            </p>
            <section className="canvas-add-node-section">
              <strong>本机新建 Agent</strong>
              <p className="muted" style={{ fontSize: "0.8rem", margin: "0.25rem 0 0.5rem 0" }}>
                在 monoU 根目录执行（将 my_agent 改为你的 agent 名）：
              </p>
              <div className="canvas-add-node-cmd-wrap">
                <code className="canvas-add-node-cmd">{ADD_NODE_CMD}</code>
                <button type="button" className="canvas-copy-btn" onClick={copyCommand}>
                  {copyDone ? "已复制" : "复制"}
                </button>
              </div>
            </section>
            <section className="canvas-add-node-section">
              <strong>远程部署</strong>
              <p className="muted" style={{ fontSize: "0.8rem", margin: "0.25rem 0 0 0" }}>
                远程机器需安装 <strong>Node.js</strong>。将 monoU 同步到远程后，在远程执行
                <code> npm install && npm run build</code>，再配置 GATEWAY_URL、AGENT_ID、AGENT_DIR 后运行{" "}
                <code>node apps/gateway/dist/agent-client.js</code>。详见{" "}
                <code>.first_paramecium/skills/agent-creator/references/remote-deploy.md</code>
              </p>
            </section>
          </div>
        )}

        <div className="canvas-wrap">
          {nodes.length === 0 ? (
            <div className="canvas-empty">
              <p>暂无节点</p>
              <p className="muted" style={{ fontSize: "0.9rem", marginTop: "0.5rem" }}>
                启动 Gateway 并连接 Agent 后可见；或按 N 查看「添加节点」说明
              </p>
              <button type="button" className="canvas-refresh-btn" style={{ marginTop: "1rem" }} onClick={() => setShowAddNode(true)}>
                + 添加节点说明
              </button>
            </div>
          ) : (
            <ReactFlow
              nodes={nodesState}
              edges={edgesState}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onMoveEnd={(_ev, viewport) => {
                const nodePositions: Record<string, { x: number; y: number }> = {};
                nodesState.forEach((nd) => {
                  nodePositions[nd.id] = nd.position;
                });
                saveCanvasState({ viewport, nodePositions });
              }}
              onNodeDragStop={() => {
                try {
                  const vp = getViewport();
                  const nodePositions: Record<string, { x: number; y: number }> = {};
                  nodesState.forEach((nd) => {
                    nodePositions[nd.id] = nd.position;
                  });
                  saveCanvasState({ viewport: vp, nodePositions });
                } catch {
                  // ignore
                }
              }}
              nodeTypes={nodeTypes}
              fitView
              fitViewOptions={{ padding: 0.35, minZoom: 0.25, maxZoom: 1.2 }}
              minZoom={0.2}
              maxZoom={1.5}
            >
              <Background color="var(--border)" gap={16} />
              <Controls />
              <MiniMap nodeColor="var(--accent)" maskColor="rgba(0,0,0,0.6)" />
            </ReactFlow>
          )}
        </div>
      </div>
    </ClusterContext.Provider>
  );
}

type Props = {
  active?: boolean;
  onOpenChat?: (agentId: string) => void;
};

export function CanvasPanel({ active, onOpenChat }: Props) {
  return (
    <ReactFlowProvider>
      <CanvasInner active={active} onOpenChat={onOpenChat} />
    </ReactFlowProvider>
  );
}
