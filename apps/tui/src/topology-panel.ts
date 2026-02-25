/**
 * 拓扑面板 — 与 Web OverviewPanel 对齐：Gateway 全景、节点列表、接入列表（仅列表视图）
 */
import { truncateToWidth } from "@monou/tui";
import type { Component } from "@monou/tui";
import { theme } from "./theme.js";
import type { GatewayClient } from "./gateway-client.js";

type NodeItem = {
  nodeId?: string;
  deviceId?: string;
  agents?: Array<{ agentId?: string }>;
  lastHeartbeatAt?: number;
};
type ConnectorItem = { connectorId?: string; displayName?: string };

const TITLE = "拓扑 · 节点与接入";
const FOOTER = "与 Control UI 同源  j/k 在会话/Cron 中切换 Tab";

export class TopologyPanel implements Component {
  private gw: GatewayClient;
  private nodes: NodeItem[] = [];
  private connectors: ConnectorItem[] = [];
  private loading = true;
  private err: string | null = null;

  constructor(gw: GatewayClient) {
    this.gw = gw;
  }

  invalidate(): void {}

  async load(): Promise<void> {
    this.loading = true;
    this.err = null;
    try {
      const [nr, sr] = await Promise.all([
        this.gw.call<{ nodes?: NodeItem[]; connectors?: ConnectorItem[] }>("node.list", {}, 8000),
        this.gw.call<{ agents?: number; nodes?: number }>("status", {}, 5000),
      ]);
      this.nodes = (nr as { nodes?: NodeItem[] }).nodes ?? [];
      this.connectors = (nr as { connectors?: ConnectorItem[] }).connectors ?? [];
    } catch (e) {
      this.err = (e as Error).message;
      this.nodes = [];
      this.connectors = [];
    }
    this.loading = false;
  }

  render(width: number): string[] {
    const lines: string[] = [];
    lines.push(truncateToWidth(theme.header(TITLE), width, ""));
    lines.push("");
    if (this.loading) {
      lines.push(truncateToWidth(theme.dim("  加载中…"), width, ""));
      lines.push("");
      lines.push(truncateToWidth(theme.footerHint(FOOTER), width, ""));
      return lines;
    }
    if (this.err) {
      lines.push(truncateToWidth(theme.error("✕ " + this.err), width, ""));
      lines.push("");
      lines.push(truncateToWidth(theme.footerHint(FOOTER), width, ""));
      return lines;
    }
    lines.push(truncateToWidth(theme.dim("  Gateway 是中心；下方为已连接节点与接入"), width, ""));
    lines.push("");
    if (this.connectors.length > 0) {
      lines.push(truncateToWidth(theme.accent("  接入 (Connectors)"), width, ""));
      for (const c of this.connectors) {
        const name = (c.displayName || c.connectorId || "—").slice(0, 24);
        lines.push(truncateToWidth(theme.dim("    · ") + theme.fg(name), width, ""));
      }
      lines.push("");
    }
    lines.push(truncateToWidth(theme.accent("  节点 (Nodes)"), width, ""));
    if (this.nodes.length === 0) {
      lines.push(truncateToWidth(theme.dim("    (无节点)"), width, ""));
    } else {
      for (const n of this.nodes) {
        const deviceLabel = (n.deviceId === "1270000001" || n.deviceId === "local") ? "本机" : (n.nodeId || n.deviceId || "—");
        lines.push(truncateToWidth(theme.dim("    · ") + theme.fg(deviceLabel), width, ""));
        const agents = n.agents ?? [];
        for (const a of agents) {
          lines.push(truncateToWidth(theme.dim("      Agent: ") + theme.accent(a.agentId ?? "—"), width, ""));
        }
      }
    }
    lines.push("");
    lines.push(truncateToWidth(theme.footerHint(FOOTER), width, ""));
    return lines;
  }
}
