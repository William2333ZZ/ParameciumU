/**
 * 能力通讯录：按节点分组，节点下展示该节点具备的能力（如浏览器），点选后在右侧展示对应能力 UI。
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { gatewayClient } from "../gateway-client";
import { CAPABILITY_REGISTRY, nodeDisplayNameForList } from "../capability-registry";
import type { NodeItem } from "../types";

type NodeListPayload = { nodes?: NodeItem[] };

/** 节点具备的、已注册的能力 key 列表 */
function getNodeCapabilities(node: NodeItem): string[] {
  const caps = node.capabilities ?? [];
  return caps.filter(
    (key) => typeof key === "string" && CAPABILITY_REGISTRY[key] && CAPABILITY_REGISTRY[key].filterNode(node)
  );
}

export function CapabilitiesPanel() {
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [selectedCapability, setSelectedCapability] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const load = useCallback(() => {
    setErr(null);
    setLoading(true);
    gatewayClient
      .request<NodeListPayload>("node.list")
      .then((res) => {
        if (res.ok && res.payload?.nodes) setNodes(res.payload.nodes as NodeItem[]);
        else setNodes([]);
      })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** 仅展示至少具备一种已注册能力的节点，按节点分组，每节点下列出能力 */
  const nodesWithCaps = useMemo(() => {
    return nodes
      .map((n) => ({ node: n, caps: getNodeCapabilities(n) }))
      .filter(({ caps }) => caps.length > 0);
  }, [nodes]);

  const selectedDef = selectedCapability ? CAPABILITY_REGISTRY[selectedCapability] : null;

  return (
    <div className="capabilities-panel">
      <div className="capabilities-list-column">
        <h2 className="capabilities-list-title">能力通讯录</h2>
        {loading ? (
          <p className="loading">加载中…</p>
        ) : err ? (
          <p className="error">{err}</p>
        ) : nodesWithCaps.length === 0 ? (
          <p className="capabilities-type-empty">暂无具备能力的节点</p>
        ) : (
          <div className="capabilities-by-node">
            {nodesWithCaps.map(({ node, caps }) => (
              <section key={node.nodeId} className="capabilities-node-group">
                <h3 className="capabilities-node-name">{nodeDisplayNameForList(node)}</h3>
                <ul className="capabilities-cap-list">
                  {caps.map((key) => {
                    const def = CAPABILITY_REGISTRY[key];
                    if (!def) return null;
                    const isActive = selectedNodeId === node.nodeId && selectedCapability === key;
                    return (
                      <li key={key} className="capabilities-cap-item">
                        <button
                          type="button"
                          className={`capabilities-cap-btn ${isActive ? "active" : ""}`}
                          onClick={() => {
                            setSelectedNodeId(node.nodeId);
                            setSelectedCapability(key);
                          }}
                        >
                          {def.label}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
      <div className="capabilities-detail-column">
        {selectedDef && selectedNodeId ? (
          (() => {
            const { Panel } = selectedDef;
            return <Panel initialNodeId={selectedNodeId} />;
          })()
        ) : (
          <div className="capabilities-detail-empty">
            <p>从左侧选择节点与能力，查看或操作该能力</p>
          </div>
        )}
      </div>
    </div>
  );
}
