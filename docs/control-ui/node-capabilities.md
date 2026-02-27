---
title: "Control UI 节点能力接入"
summary: "节点能力（浏览器等）与 Control UI 的通用框架、能力注册表与 Panel 接入思路"
read_when:
  - 在 Control UI 中接入新节点能力时
  - 理解能力通讯录与 BrowserPanel 时
---

# Control UI：节点能力（浏览器等）接入思路

本文档讨论如何把**节点能力**（如 browser、未来其他软件/节点）结合到 Control UI，以及 Gateway 是否做成「通用」、UI 是否做成「通用」的问题。

---

## 一、当前状态

### 1.1 Gateway 侧（已是通用）

- **node.list**：返回节点列表，每个节点可带 `capabilities?: string[]`（如 `["browser"]`）、`vncPort?: number` 等，均由**节点在 connect 时自行上报**，Gateway 不枚举「有哪些能力类型」。
- **node.invoke(nodeId, command, params)**：通用 RPC，Gateway 只做转发：把请求发到对应节点，节点执行后通过 `node.invoke.result` 回传。Gateway **不解析** command 含义。
- 结论：**Gateway 已经是「通用」的**——能力类型、命令名、参数与返回结构都由节点定义，Gateway 只做透传。

### 1.2 Control UI 侧

- **NodeItem** 类型已有 `capabilities?: string[]`、`vncPort?: number`。
- **BrowserPanel**：根据 `capabilities.includes("browser")` 筛出「浏览器节点」，用 `node.invoke(nodeId, "browser_screenshot", {})` 拉截图并展示。这是**针对 browser 能力写死的 UI**。
- 当前主导航只有「消息、Agent 通讯录、设置」，Browser 面板未在侧栏露出，需要一种方式把「节点能力」重新接入。

---

## 二、要解决的问题

1. **能力从哪来**：Gateway 不、也不应维护「全系统能力类型列表」；能力由各节点 connect 时声明，node.list 汇总即可。
2. **UI 怎么展示**：是每种能力一个 Tab/页面（如浏览器），还是**一个通用入口**下按能力类型切换？
3. **是否做成通用**：  
   - **协议/Gateway**：保持通用（已满足）。  
   - **Control UI**：可以做成「通用能力框架 + 按能力类型的 UI 插件」，既避免每加一种能力就乱加导航，又保证浏览器等有专门交互（截图、VNC 等）。

---

## 三、推荐方向：通用框架 + 能力插件，入口挂在「节点/Agent 通讯录」

### 3.1 原则

- **Gateway**：继续不枚举能力，只透传 node.list / node.invoke。
- **Control UI**：
  - 不为主导航增加「浏览器」「XX 能力」等一堆 Tab，而是提供**一个统一的能力入口**（见下）。
  - 前端维护一份**能力注册表**：每种能力类型对应「如何筛节点、调什么 command、用什么 UI 展示」。新能力 = 新加一条注册 + 一个 Panel（或复用通用 invoke 面板）。

### 3.2 能力入口（已实现：能力通讯录）

**已采用：单独「能力通讯录」Tab**

- 主导航为 **「能力通讯录」**；进入后左侧按**节点**分组（与 Agent 通讯录一致：本机 / nodeId），每个节点下列出该节点具备的**能力**（来自注册表，如「浏览器」）；右侧为选中「节点 + 能力」后的能力 UI（如浏览器截图）。
- 逻辑：**先选节点，再选该节点下的能力**；与 Agent 通讯录「先选节点，再看智能体详情」一致，便于按节点管理能力。
- 实现：`CapabilitiesPanel` + `capability-registry.tsx`；仅展示至少具备一种已注册能力的节点。新增能力只需在注册表加一条并实现 Panel。BrowserPanel 支持 `initialNodeId` 供能力面板传入以预选节点。

### 3.3 能力注册表（前端）

前端维护一个「能力类型 → 配置 + 组件」的映射，例如：

```ts
// 概念示例
const CAPABILITY_REGISTRY = {
  browser: {
    label: "浏览器",
    filterNode: (n: NodeItem) => n.capabilities?.includes("browser"),
    Panel: BrowserPanel,           // 或内嵌 Browser 内容
    defaultCommand: "browser_screenshot",
    // 可选：invoke 时固定 params、结果如何解析等
  },
  // 未来: sandbox: { label: "沙箱", filterNode: ..., Panel: SandboxPanel },
};
```

- **筛选节点**：node.list 后按 `filterNode` 得到「具备该能力的节点」。
- **展示**：在 Agent 通讯录节点详情里，根据节点 `capabilities` 列出可点击的能力；点击后渲染对应 `Panel`，并传入 `nodeId`（及可选 node 信息）。
- **调用**：Panel 内仍用 `node.invoke(nodeId, command, params)`；command/params 可由注册表或 Panel 内部决定。

这样：

- **通用**：新增一种能力 = 在注册表加一项 + 实现一个 Panel，无需改 Gateway，也无需改「Agent 通讯录」主框架，只扩展能力区。
- **可退化**：若某种能力暂时没有专门 Panel，可以落到一个「通用 node.invoke 调试面板」（输入 command/params，显示原始 result），便于开发调试。

---

## 四、是否做成「完全通用」的 node.invoke 控制台？

- **可以做**：一个「节点列表 + 输入 command + params + 显示 result」的调试页，不区分能力类型，所有调用都通过 node.invoke。
- **适用**：开发/排查、或能力尚未有专门 UI 时。
- **不替代**：浏览器等需要「看图、操作」的能力，仍应有专门 UI（截图、VNC）；否则体验差且对非技术用户不友好。

建议：**通用 invoke 面板**作为补充（例如放在设置里「调试」或能力列表里「原始调用」），与「按能力类型的 Panel」并存。

---

## 五、小结与当前实现

| 层面 | 建议 | 当前实现 |
|------|------|----------|
| **Gateway** | 保持通用 | 不变；node.list / node.invoke 透传。 |
| **Control UI** | 通用框架 + 能力插件 | `capability-registry.tsx` 注册表 + 各能力 Panel（如 BrowserPanel）。 |
| **能力入口** | 单独「能力」入口 | 主导航已增加 **「能力」**；CapabilitiesPanel 按能力类型列节点，右侧挂载对应 Panel。 |
| **扩展方式** | 新能力 = 新注册 + 新 Panel | 在 `CAPABILITY_REGISTRY` 增加一项并实现 `Panel` 组件即可。 |

- 主导航现为：**消息、Agent 通讯录、能力通讯录、设置**。
- 能力通讯录：左侧按**节点**分组，节点下为该节点能力（如浏览器）；右侧为能力 UI（如浏览器截图，支持 `initialNodeId` 预选节点）。

## 下一步

- Control UI 整体设计：[design](./design.md)
- Browser Node 设计：[browser-node-design](../reference/browser-node-design.md)
- Gateway node.list / node.invoke：[gateway](../runtime/gateway.md)
