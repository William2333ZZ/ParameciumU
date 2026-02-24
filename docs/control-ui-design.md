# Control UI 界面与交互设计

本文档定义 monoU Control UI 的入口逻辑、信息架构、层级与交互，与 [architecture.md](./architecture.md)、[gateway.md](./gateway.md) 一致。

---

## 一、产品目标与原则

- **定位**：L1 Connector（Web），连接 Gateway，面向「操作者」的统一控制台。
- **核心任务**：与 Agent 对话、查看拓扑与会话、管理 Cron、管理连接与设置。
- **原则**：主任务路径短、层级清晰、避免重复入口、与 Gateway 无状态路由语义一致。

---

## 二、入口逻辑

### 2.1 连接前（未连接）

- **唯一入口**：连接页（ConnectForm）。
- **输入**：Gateway URL（必填）、Token / Password（可选）。
- **来源**：
  - 本地存储：上次使用的 URL/Token 自动填充（仅填充，不自动连接）。
  - URL 参数：`?gatewayUrl=ws://...&token=...` 用于外链/嵌入场景；连接成功后建议清除 query，避免泄露。
- **默认 URL**：开发时 localhost 可默认 `ws://127.0.0.1:18790`（与 README 默认端口一致）；生产/非 localhost 留空。
- **错误**：连接失败时在表单下方展示错误信息；对「invalid request frame」等给出「请确认是 monoU Gateway」的提示（保持现有逻辑）。

### 2.2 连接后（已连接）

- **主界面**：侧栏 + 主内容区；**默认首屏为「对话」**，便于用户连上即聊。
- **断开**：侧栏底部「断开」或设置页「断开连接」→ 回到连接页，清空连接状态与错误。
- **重连**：断开后再次连接视为新连接；不维护「自动重连」逻辑（可后续按需加）。

### 2.3 入口小结

```
[打开 Control UI]
       │
       ▼
  ┌─────────────┐
  │  连接页      │  ← URL/Token 来自存储或 ?gatewayUrl=&token=
  │  (必填 URL)  │
  └──────┬──────┘
         │ 连接成功
         ▼
  ┌─────────────┐
  │  主界面      │  默认 Tab = 对话
  │  侧栏+主区   │
  └─────────────┘
```

---

## 三、接入的前端表述与 Session 是否同一套

### 3.1 前端表述：谁算「接入」

- **接入（Connectors）**：所有以「连接方」身份连上 Gateway 的入口，在架构里统一叫 L1 Connector。
- **前端可展示为**：
  - 拓扑页：区分 **「接入」** 与 **「节点」** 两块。接入 = 已连接的 Connector 列表（如飞书、本控制台、未来企微等）；节点 = 已连接的 Agent 运行端（node.list 的 nodes）。
  - 文案建议：用「接入」或「Connectors」均可；列表项显示 `displayName ?? connectorId`（如「飞书」「feishu」），并标注在线状态。
- **当前实现**：Control UI 连接时 `role: "operator"`，不占 connectorId；飞书 feishu-app 连接时 `role: "connector"` 并带 connectorId/connectorDisplayName，会出现在 node.list 的 `connectors` 里。TUI 若以 operator 连接则不会出现在 connectors 列表，但会话层面与 Control UI 共用同一套 Gateway 会话（见下）。

### 3.2 接入时 Session 是否同一套

- **是，同一套。** 所有接入（Control UI、TUI、飞书等）的会话都由 **Gateway 统一存储**，不存在「飞书一套、Control UI 另一套」。
- **存储**：`.gateway/sessions/sessions.json`（元数据）+ `.gateway/sessions/transcripts/<sessionKey>.json`（单条会话内容）。无论来自哪端，只要命中同一 sessionKey，就是同一条会话。
- **sessionKey 来源**：
  - Control UI / TUI 发 `chat.send` 或 `agent` 时：可带 `sessionKey`，或不带则由 Gateway 按策略新建（如 `agent:.u:s-<timestamp>-<random>`）。
  - 飞书等 Connector 发 `connector.message.inbound` 时：Gateway 固定用 `connector:<connectorId>:chat:<chatId>` 作为 sessionKey（例如 `connector:feishu:chat:oc_xxx`），并写入同一份 sessions.json / transcripts。
- **会话列表**：Control UI 的「会话」Tab 调用 `sessions.list`，拿到的是 **全部** Gateway 会话，包括 Control UI 自己开的、TUI 用过的、飞书某群聊对应的；可通过 sessionKey 前缀或 SessionEntry 的 channel/displayName 等区分来源。
- **小结**：多端看到的「会话」是同一套；不同接入只是不同入口，最终都对应到 Gateway 的某条 sessionKey，便于统一管理、排查和后续做「在 Control UI 里打开飞书某群对应的会话」等能力。

---

## 四、信息架构与层级

### 4.1 当前问题

- 侧栏 6 个 Tab 平级：对话、概览、节点图、会话、Cron、设置，无主次区分。
- 「概览」与「节点图」是同一数据（node.list + agents）的两种展示（列表 vs 图），入口重复、概念分散。

### 4.2 建议层级

| 层级 | 名称 | 说明 |
|------|------|------|
| **主任务** | 对话 | 与选定 Agent 的会话；默认首屏，主内容区核心。 |
| **拓扑** | 拓扑 / 节点 | 统一入口：Gateway → 节点 → Agent、Connectors；内部分「列表」与「图」两种视图切换，不再拆成两个 Tab。 |
| **会话** | 会话 | 所有会话列表，点击在「对话」中打开。 |
| **定时** | Cron | 定时任务列表与立即运行。 |
| **设置** | 设置 | 连接信息、断开、调试信息（health/status 原始数据）。 |

即：**5 个一级入口**——对话、拓扑、会话、Cron、设置；其中「拓扑」内部含列表/图切换。

### 4.3 侧栏结构（建议）

```
┌─────────────────────┐
│ ● monoU             │  连接指示 + 品牌
├─────────────────────┤
│ 对话                │  主任务，默认选中
│ 拓扑                │  列表/图 在面板内切换
│ 会话                │
│ Cron                │
│ 设置                │
├─────────────────────┤
│ 断开                │
└─────────────────────┘
```

- 去掉原「概览」「节点图」两个独立 Tab，合并为「拓扑」一个 Tab；在拓扑面板顶部提供「列表 | 图」切换（或左右分栏），减少侧栏项、统一「节点与 Agent」心智。

---

## 五、交互逻辑

### 5.1 主任务路径：对话

- **进入**：连上后默认即对话 Tab；Agent 默认 `.u`，session 默认 main（或当前选中的 sessionKey）。
- **选 Agent**：从「拓扑」点某 Agent 的「对话」→ 切到对话 Tab 并带入 agentId（及可选 sessionKey）；从「会话」点某条会话 → 切到对话 Tab 并带入 agentId + sessionKey。
- **对话内**：支持切换会话（当前会话列表）、新建会话、发消息、流式展示、工具调用展示（保持现有 ChatPanel 能力）。

### 5.2 拓扑

- **数据**：node.list（nodes + connectors）、必要时 status 汇总（agents/nodes 数）。
- **视图**：
  - **列表**：Gateway 简介 + 统计（Agent 数、节点数、接入数、Cron 数）+ 节点树（节点 → Agent 列表）+ 每个 Agent 提供「对话」按钮。
  - **图**：当前 CanvasPanel 的 ReactFlow 图（Gateway 在上、节点在下环形排布），节点/Agent 可点「对话」。
- **交互**：列表/图切换在同一面板内（Tab 或 SegmentedControl），不离开「拓扑」Tab。

### 5.3 会话

- 列表展示 sessions.list；每项可点「打开」→ 跳转对话 Tab 并传入对应 agentId + sessionKey。
- 与现有 SessionsPanel 行为一致，仅明确「打开」= 在对话中打开。

### 5.4 Cron

- **归属**：Cron 一定属于某个 Agent（该 Agent 目录下的 `cron/jobs.json`）。界面先选 Agent，再展示该 Agent 的定时任务。
- **Gateway**：cron.list / cron.run / cron.add / cron.update / cron.remove / cron.status 均支持 `params.agentId`（默认 .u）。按 agentId 解析 store 路径：.u → `.u/cron/jobs.json`，其他 → `agents/<agentId>/cron/jobs.json`。
- **Control UI**：选任意 Agent 后请求 cron.list({ agentId })，展示该 Agent 的任务列表；立即运行传 cron.run({ id, agentId })。

### 5.5 设置

- 当前 Gateway URL、已保存 URL、Token 占位展示、断开连接按钮。
- 底部可折叠「调试信息」：展开时请求 health + status，展示原始 JSON（保持现有逻辑）。

### 5.6 跨面板跳转约定

| 来源 | 动作 | 目标 | 参数 |
|------|------|------|------|
| 拓扑（列表/图） | 点 Agent「对话」 | 对话 Tab | agentId |
| 会话 | 点某会话「打开」 | 对话 Tab | agentId, sessionKey |
| 对话 | 切换会话/新建 | 本面板 | - |

所有「打开对话」的入口统一：`openChat(agentId, sessionKey?)`；无 sessionKey 时对话面板用默认或 main。

---

## 六、路由与状态（可选）

- **当前**：无 URL 路由，仅内存 state（tab、openChatPayload）。
- **可选演进**：
  - 使用 Hash 或 History 路由，例如：`#/chat`、`#/topology`、`#/sessions`、`#/cron`、`#/settings`；`#/chat?agentId=.u&sessionKey=...` 便于分享或书签。
  - 连接页仍为独立「未连接」态，不写 Tab 路由；连接后根据 hash 恢复 Tab，缺省为 `/chat`。

若不引入路由，保持「侧栏 Tab + 内存 state」即可，实现简单。

---

## 七、实施要点小结

1. **入口**：连接页唯一；连接后主界面默认「对话」Tab。
2. **层级**：5 个一级 Tab——对话、拓扑、会话、Cron、设置。
3. **合并**：原「概览」与「节点图」合并为「拓扑」，在拓扑面板内提供列表/图切换。
4. **交互**：拓扑/会话 → 点「对话」或「打开」→ 统一跳转对话并带 agentId（+ sessionKey）。
5. **设置**：保留连接信息、断开、调试信息折叠区；不单独做「状态」Tab。

按此设计可实现更清晰的信息架构和更短的主任务路径，并与 docs 中 Gateway/Agent 的职责一致。
