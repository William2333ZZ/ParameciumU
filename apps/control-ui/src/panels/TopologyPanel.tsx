import { useState } from "react";
import { OverviewPanel } from "./OverviewPanel";
import { CanvasPanel } from "./CanvasPanel";

type Props = {
  isActive?: boolean;
  onOpenChat: (agentId: string, sessionKey?: string) => void;
};

type ViewMode = "list" | "graph";

/**
 * 拓扑 Tab：Gateway → 节点 → Agent、接入；内部分「列表」与「图」两种视图切换（对齐 control-ui-design）。
 */
export function TopologyPanel({ isActive, onOpenChat }: Props) {
  const [view, setView] = useState<ViewMode>("list");

  return (
    <div className="topology-panel">
      <div className="topology-toolbar">
        <span className="topology-toolbar-label">视图</span>
        <div className="topology-view-toggle" role="tablist" aria-label="列表或图">
          <button
            type="button"
            role="tab"
            aria-selected={view === "list"}
            className={`topology-view-btn ${view === "list" ? "active" : ""}`}
            onClick={() => setView("list")}
          >
            列表
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "graph"}
            className={`topology-view-btn ${view === "graph" ? "active" : ""}`}
            onClick={() => setView("graph")}
          >
            图
          </button>
        </div>
      </div>
      {view === "list" && (
        <div className="topology-content topology-content--list">
          <OverviewPanel onOpenChat={onOpenChat} />
        </div>
      )}
      {view === "graph" && (
        <div className="topology-content topology-content--graph">
          <CanvasPanel active={isActive !== false} onOpenChat={onOpenChat} />
        </div>
      )}
    </div>
  );
}
