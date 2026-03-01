---
title: "Control UI: node capabilities"
summary: "How node capabilities (e.g. browser) plug into Control UI: registry, panels, and extension pattern."
read_when:
  - Adding a new node capability to Control UI
  - Understanding the capabilities panel and BrowserPanel
---

# Control UI: node capabilities

This doc describes how **node capabilities** (e.g. browser, future sandbox UI or other nodes) integrate with Control UI, and how the Hub and UI stay generic.

---

## 1. Current state

### 1.1 Hub (Gateway)

- **node.list** returns nodes; each can have `capabilities?: string[]` (e.g. `["browser"]`), `vncPort?: number`, etc., **reported by the node** on connect. The Hub does not enumerate capability types.
- **node.invoke(nodeId, command, params)** is a generic RPC: the Hub forwards to the node and returns the result. The Hub does **not** interpret command names or payloads.
- So the **Hub is already generic** — capability types, commands, and payloads are defined by nodes.

### 1.2 Control UI

- **NodeItem** has `capabilities?: string[]`, `vncPort?: number`.
- **BrowserPanel:** Filters nodes with `capabilities.includes("browser")`, calls `node.invoke(nodeId, "browser_screenshot", {})` and shows the image. This is **browser-specific UI**.
- Top nav: Messages, Agent directory, Node capabilities, Settings. Node capabilities are exposed via the **Node capabilities** tab.

---

## 2. Design: generic framework + capability plugins

### 2.1 Principles

- **Hub:** Stay generic; no global capability list; nodes declare capabilities on connect.
- **Control UI:** One **capabilities entry** (tab), with a **capability registry** in the frontend: each capability type has a filter, optional panel, and default command. New capability = add registry entry + panel (or reuse a generic invoke panel).

### 2.2 Capabilities tab (current)

- **Nav:** “Node capabilities” tab.
- **Left:** Nodes grouped by node (same as Agent directory). Under each node, list its **capabilities** (from the registry, e.g. “Browser”).
- **Right:** For selected “node + capability”, show the capability UI (e.g. browser screenshot). Logic: **select node, then capability**; consistent with Agent directory.
- **Implementation:** `CapabilitiesPanel` + `capability-registry`; only nodes with at least one registered capability are shown. New capability = add to registry + implement Panel. BrowserPanel supports `initialNodeId` for pre-selection.

### 2.3 Capability registry (frontend)

The frontend keeps a mapping from capability type to config + component, e.g.:

```ts
const CAPABILITY_REGISTRY = {
  browser: {
    label: "Browser",
    filterNode: (n: NodeItem) => n.capabilities?.includes("browser"),
    Panel: BrowserPanel,
    defaultCommand: "browser_screenshot",
  },
  // future: sandbox: { label: "Sandbox", filterNode: ..., Panel: SandboxPanel },
};
```

- **Filter:** After node.list, use `filterNode` to get nodes that have that capability.
- **UI:** In the capabilities tab, list capabilities per node; on click, render the Panel with `nodeId`.
- **Invoke:** Panels call `node.invoke(nodeId, command, params)`; command/params can come from the registry or the panel.

Adding a new capability = one registry entry + one Panel (or reuse a generic invoke panel).

### 2.4 Generic node.invoke debug panel

- **Optional:** A “raw” panel: node list + command + params input + result display. Useful for development or capabilities that don’t have a dedicated UI yet.
- **Place:** e.g. under Settings as “Debug” or inside the capabilities list as “Raw invoke”. Does not replace dedicated panels (e.g. browser) for better UX.

---

## 3. Summary

| Layer | Approach | Current |
|-------|----------|---------|
| **Hub** | Generic | node.list / node.invoke; no capability enum. |
| **Control UI** | Registry + capability panels | capability-registry + BrowserPanel, etc. |
| **Entry** | Single “Node capabilities” tab | Nav: Messages, Agent directory, Node capabilities, Settings. |
| **Extension** | New capability = new registry entry + Panel | Add to CAPABILITY_REGISTRY and implement Panel. |

## Next steps

- [Control UI design](./design.md)
- [Browser node design](../reference/browser-node-design.md)
- [Gateway protocol](../gateway/protocol.md)
