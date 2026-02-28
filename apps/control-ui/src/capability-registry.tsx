/**
 * 能力注册表：能力类型 -> 展示名、节点筛选、内容组件。
 * 新增能力时在此注册，能力通讯录会自动展示并挂载对应 Panel。
 */
import type { ComponentType } from "react";
import type { NodeItem } from "./types";
import { BrowserPanel } from "./panels/BrowserPanel";

export type CapabilityDef = {
  label: string;
  filterNode: (n: NodeItem) => boolean;
  Panel: ComponentType<{ initialNodeId?: string }>;
};

const LOCAL_DEVICE_IDS = ["1270000001", "local"];

function nodeDisplayName(n: NodeItem): string {
  if (n.deviceId && LOCAL_DEVICE_IDS.includes(n.deviceId)) return "本机";
  return n.nodeId;
}

export const CAPABILITY_REGISTRY: Record<string, CapabilityDef> = {
  browser: {
    label: "浏览器",
    filterNode: (n) => Array.isArray(n.capabilities) && n.capabilities.includes("browser"),
    Panel: BrowserPanel,
  },
};

export function nodeDisplayNameForList(n: NodeItem): string {
  return nodeDisplayName(n);
}
