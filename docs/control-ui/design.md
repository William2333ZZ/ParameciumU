---
title: "Control UI 界面与交互设计"
summary: "Control UI 入口逻辑、信息架构、消息/通讯录/设置层级与交互"
read_when:
  - 开发或改版 Control UI 时
  - 理解消息、Agent 通讯录、能力通讯录数据流时
---

# Control UI 界面与交互设计

本文档定义 monoU Control UI 的入口逻辑、信息架构、层级与交互，与 [architecture.md](../architecture/architecture.md)、[gateway.md](../runtime/gateway.md) 一致。

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

- **主界面**：侧栏 + 主内容区；**默认首屏为「消息」**（最近聊天列表 + 聊天区），便于用户连上即聊。
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
  │  主界面      │  默认 Tab = 消息
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
- **存储**：`.gateway/sessions/sessions.json`（元数据）+ `.gateway/sessions/transcripts/&lt;sessionKey&gt;.json`（单条会话内容）。无论来自哪端，只要命中同一 sessionKey，就是同一条会话。
- **sessionKey 来源**：
  - Control UI / TUI 发 `chat.send` 或 `agent` 时：可带 `sessionKey`，或不带则由 Gateway 按策略新建（如 `agent:.u:s-&lt;timestamp&gt;-&lt;random&gt;`）。
  - 飞书等 Connector 发 `connector.message.inbound` 时：Gateway 固定用 `connector:&lt;connectorId&gt;:chat:&lt;chatId&gt;` 作为 sessionKey（例如 `connector:feishu:chat:oc_xxx`），并写入同一份 sessions.json / transcripts。
- **会话列表**：Control UI 的「消息」视图中的最近聊天列表及 Agent 通讯录历史对话等会调用 `sessions.list`，拿到的是 **全部** Gateway 会话，包括 Control UI 自己开的、TUI 用过的、飞书某群聊对应的；可通过 sessionKey 前缀或 SessionEntry 的 channel/displayName 等区分来源。
- **小结**：多端看到的「会话」是同一套；不同接入只是不同入口，最终都对应到 Gateway 的某条 sessionKey，便于统一管理、排查和后续做「在 Control UI 里打开飞书某群对应的会话」等能力。

---

## 四、信息架构与层级（当前实现：微信式）

### 4.1 一级导航（与实现一致）

- **侧栏一级入口**：**消息**、**Agent 通讯录**、**能力通讯录**、**设置**，参考微信；拓扑、Cron、浏览器等不再作为主导航，智能体在 Agent 通讯录内按节点查看，能力在能力通讯录内按节点查看。

### 4.2 当前层级

| 层级 | 名称 | 说明 |
|------|------|------|
| **主任务** | 消息 | 默认首屏。中栏为「最近聊天」列表（按最近聊天时间排序），右栏为当前会话的聊天区；支持已读/未读（纯前端 localStorage）。 |
| **Agent 通讯录** | Agent 通讯录 | 按**节点**分组的智能体列表，标题「Agent 通讯录」；点选某智能体后右侧展示：状态（在线/离线，90s 心跳）、定时任务（cron.list + 立即运行）、历史对话、发消息。 |
| **设置** | 设置 | 连接信息、断开、调试信息（health/status 折叠区，深色样式）。 |

### 4.3 侧栏结构（当前）

```
┌─────────────────────┐
│ ● monoU             │  连接指示 + 品牌
├─────────────────────┤
│ 消息                │  主任务，默认选中 → 中栏最近聊天 + 右栏聊天
│ Agent 通讯录        │  按节点分组智能体，右侧详情（状态/定时任务/历史对话）
│ 设置                │
├─────────────────────┤
│ 断开                │
└─────────────────────┘
```

---

## 五、交互逻辑（当前实现）

### 5.1 消息（主任务路径）

- **进入**：连上后默认「消息」；中栏为「最近聊天」单列表（智能体 + 群聊会话，按最近聊天时间排序），右栏未选会话时显示欢迎页。
- **最近聊天列表**：
  - 数据：node.list 的智能体（取该 agent 下会话的最大 updatedAt 作排序）+ sessions.list 中群聊会话（connector:*:chat:* 等），合并后按时间降序。
  - **在线状态**：与 Agent 通讯录一致，90 秒内有心跳为在线，显示绿点；否则灰点。
  - **已读/未读**：纯前端 localStorage（`monou_chat_last_read`）存每会话上次已读时间；列表项若 updatedAt > lastRead 则显示红点，进入会话即标记已读。
- **选会话**：点智能体 → `openChat(agentId)` 打开该 Agent 主会话；点群聊 → `openChat(agentId, sessionKey)`。右栏 ChatPanel 仅展示「对话」标题与当前会话的会话列表（↻ 刷新、+ 新建、会话列表），**不再展示 Agent 输入框**；当前 Agent/会话由主视图传入。

### 5.2 Agent 通讯录

- **左侧**：按**节点**分组（节点展示名：本机或 nodeId），每组下为该节点上的智能体列表，每项有在线/离线点；无「智能体」标题。
- **右侧**：点选某智能体后展示——**状态**（在线/离线、最近心跳）、**定时任务**（cron.list + 立即运行）、**历史对话**（该 agent 的 sessions 列表，点开在消息中打开）、**发消息**（切回消息并 openChat(agentId)）。
- Cron 归属与 Gateway 语义不变：cron.list({ agentId })、cron.run({ id, agentId })。

### 5.3 设置

- 当前 Gateway URL、已保存 URL、Token 占位、断开连接。
- **调试信息**：折叠按钮（样式独立，非侧栏 nav-item）；展开后请求 health + status，原始 JSON 使用深色底与浅色字，避免白底灰字。

### 5.4 跨面板跳转约定

| 来源 | 动作 | 目标 | 参数 |
|------|------|------|------|
| 消息·最近聊天 | 点智能体 | 消息右栏聊天 | agentId |
| 消息·最近聊天 | 点群聊 | 消息右栏聊天 | agentId, sessionKey |
| Agent 通讯录 | 点智能体「发消息」或历史对话某条 | 消息 | agentId 或 agentId + sessionKey |

统一入口：`openChat(agentId, sessionKey?)`；无 sessionKey 时对话使用该 Agent 的 main 会话。

---

## 六、路由与状态（可选）

- **当前**：无 URL 路由，仅内存 state（tab、openChatPayload）。
- **可选演进**：
  - 使用 Hash 或 History 路由，例如：`#/chat`、`#/topology`、`#/sessions`、`#/cron`、`#/settings`；`#/chat?agentId=.u&sessionKey=...` 便于分享或书签。
  - 连接页仍为独立「未连接」态，不写 Tab 路由；连接后根据 hash 恢复 Tab，缺省为 `/chat`。

若不引入路由，保持「侧栏 Tab + 内存 state」即可，实现简单。

---

## 七、实施要点小结（当前实现）

1. **入口**：连接页唯一；连接后主界面默认「消息」。
2. **层级**：一级入口——消息、Agent 通讯录、能力通讯录、设置；消息为三栏（侧栏 + 最近聊天列表 + 聊天区）。
3. **消息**：最近聊天单列表（按时间排序）、在线绿点（90s 心跳）、已读未读红点（localStorage）；聊天区无 Agent 输入，仅「对话」标题与会话侧栏。
4. **Agent 通讯录**：按节点分组智能体，标题「Agent 通讯录」；右侧为状态、定时任务、历史对话、发消息。
5. **设置**：连接信息、断开、调试信息折叠（深色样式与独立折叠按钮）。

形态与数据对应见本文第三、四节。

## 下一步

- 节点能力与浏览器接入：[node-capabilities](./node-capabilities.md)
- Gateway 协议与会话：[gateway](../runtime/gateway.md)
- 应用运行方式：[apps](../runtime/apps.md)
- 整体架构：[architecture](../architecture/architecture.md)
