# Gateway 多智能体互动设计（重设计版）

本文档描述两套逻辑：（1）**委托到对方 session**——当前 session 聊天时如需别的 agent 做事，由该 agent **在目标 session 里直接回复**；（2）**群聊 session**——多人/多 agent 在同一会话中的组织方式。

**术语**：UI 上的「窗口」对应的是 **session**（一个 session 在 Control UI 里呈现为一个对话窗口/tab）。谁回复，就是哪个 **agent 在该 session 的 transcript 里直接写回复**。

**关于「无本地 agent」**：本仓库的 Gateway **不内嵌 agent 执行**（不调用 runAgent），所有对话与群聊执行均由**已连接至 Gateway 的 agent 进程**完成。你需要单独启动每个 agent（例如 `npm run agent` 且 `AGENT_ID=.first_paramecium`、另起一个 `AGENT_ID=code_engineer`），它们通过 WebSocket 连接 Gateway 后作为「远程节点」接收 node.invoke.request；replyMode "all"（所有人回复）与 "task"（任务轮转直到完成）都是 Gateway 向这些**已连接节点**发请求，不存在「在 Gateway 进程里跑一个本地 agent」。

---

## 一、设计原则与现状

### 1.1 Session 与 UI 的对应关系

- 基本单位是 **session**（由 sessionKey 标识）。Control UI 左侧列表里：每个 **Agent** 一项对应打开该 agent 的**主 session**（`agent:<agentId>:main`）；另有按 sessionKey 的会话（群聊、connector 等）。
- **当前选中的 session** = 当前 `(agentId, sessionKey)`。发消息时由该 agentId 执行，**该 agent 的回复直接写入该 session 的 transcript**。打开这个 session 就看到这条回复。
- 因此：**agent 直接在 session 里回复**——回复写入哪个 session 的 transcript，该 session 打开时就能看到。

### 1.2 目标

1. **委托到对方 session**：当前在 A 的 session，A 决定让 B 处理时，把任务发到 **目标 session**（例如 B 的主 session `agent:B:main`），由 **B 在该 session 内直接回复**（回复写入该 session 的 transcript）。用户打开那个 session（在 UI 上即切换到对应窗口/tab）即可看到 B 的回复。可选：把 B 的回复内容返回给 A，A 可在自己 session 里提示「已转交 B，请打开 B 的 session 查看」或简短引用。
2. **群聊 session**：一个 session 内有多方参与（至少多个 agent + 用户），需要定义：会话类型、transcript 里谁说话、谁回复、如何路由。

---

## 二、委托到对方 Session（agent 在 session 内直接回复）

### 2.1 语义

- 用户在 **A 的 session** 发消息，A 推理后决定「这件事交给 B」。
- A 调用工具：**把一条消息发到目标 session**（例如 B 的主 session `agent:B:main`）。由 **B 在该 session 里直接执行并回复**——回复写入该 session 的 transcript。
- 用户打开该 session（在 UI 上即切换到对应窗口）即可看到 B 的回复。
- 可选：Gateway 将 B 的回复内容返回给 A（作为工具结果），A 可在自己 session 里提示或引用。

### 2.2 约定

- **每个 agent 的「主 session」**：`sessionKey = agent:<agentId>:main`。委托时若不指定 sessionKey，则使用目标 agent 的 main。
- 核心：**agent 直接在 session 回复**——不把 B 的回复写到 A 的 transcript，而是写到**目标 session** 的 transcript；谁打开那个 session，谁就看到 B 的回复。

### 2.3 协议与工具

- **Gateway**：已有 `chat.send(agentId, sessionKey, message)`。委托即：指定目标 session（如 `agent:B:main`）与执行者 B，由 **B 在该 session 内跑一轮，回复直接写入该 session**。无需新 RPC。
- **Agent 工具**（gateway_skill 或新工具）：
  - **gateway_agent_send_to_session**（或 **agent_delegate**）  
    参数：`targetAgentId`（必填）、`message`（必填）、可选 `sessionKey`（不传则用 `agent:<targetAgentId>:main`）。  
    实现：`gatewayInvoke("chat.send", { agentId: targetAgentId, sessionKey: sessionKey || \`agent:${targetAgentId}:main\`, message })`。  
    返回：Gateway 的 chat.send 结果（含 B 的 text/toolCalls）。A 可提示「已转交，请打开目标 session 查看」或简短引用。
- B 的回复**只**写入目标 session 的 transcript，不写入 A 的 session。

### 2.4 直接对话；定时任务与工具由 B 自己做

委托就是 **直接对话**：A 发消息到 B 的 session，B 在该 session 里回复。不需要 A 去「帮 B 安排定时任务」或替 B 调网关。

- **定时任务**：若用户或 A 在对话里说「每天 9 点汇报一下」，**B 在回复时自己用 B 的 cron 技能**（cron_add、cron_list 等）给自己加任务即可。B 的 cron 技能操作的就是 B 自己的 `cron/jobs.json`，B 的进程跑 cron scheduler 就会到点执行。无需 A 调 `cron.add(agentId: B)`。
- **实用工具**：B 在 session 里回复或执行定时任务时，用的是 **B 自己目录下的 skills**（knowledge、browser_skill、cron 等）。B 目录里配好对应技能即可。

**小结**：A 只负责「把话发到 B 的 session」；定时任务、用工具都由 **B 自己做**（B 用自己的 cron 技能、自己的其它技能）。B 端需有 cron 技能并跑 cron scheduler，以及任务所需的其他技能即可。

### 2.5 流程小结（委托 = 直接对话）

1. 用户在 A 的 session 发：「让股票助手看下今天行情，并且每天 9 点汇报一下。」
2. A 调用 `gateway_agents_list`，得到 B（如 stock_learning）。
3. A 调用 `gateway_agent_send_to_session(targetAgentId: "stock_learning", message: "请简要汇报今日行情与建议；并给自己加一个每天 9 点的汇报定时任务。")`。
4. Gateway 执行 `chat.send(agentId: B, ...)`，**B 在该 session 内直接回复**：B 用 knowledge 等查行情、用 **自己的 cron_add** 给自己加「每天 9 点汇报」任务，回复写入该 session 的 transcript。
5. 用户打开 B 的 session 即可看到 B 的回复；到点 B 的 cron 执行，汇报同样在 B 的上下文中完成。

---

## 三、群聊 Session 设计

### 3.1 目标

- 一个 **session** 内有多方参与：至少 **多个 agent**（+ 用户）。
- 同一会话里能看到：用户消息、Agent A 的回复、Agent B 的回复，即「群聊」时间线。
- 需要解决：**谁在群里、谁回复、transcript 如何存、路由规则**。

### 3.1.1 以人类心智设计：拉人进群 + 获得群聊全部历史

按**人类群聊**的心智来设计，更容易对齐预期行为。

**人类群聊里会发生什么**

- 建群后可以**拉人进群**；新进来的人能看到**进群之前的全部聊天记录**（翻记录）。
- 每个人发言都落在**同一条时间线**上，谁说了什么一目了然。
- 可以 @ 某人回复，也可以大家轮着来、一起把一件事做完。

**对应到 Agent 群聊**

| 人类行为 | Agent 群聊约定 |
|----------|----------------|
| 拉人进群 | **拉 agent 进群**：支持在已有群聊中把新 agent 加入 participant。通过 **sessions.patch** 更新该 session 的 `participantAgentIds`（append 新 agentId），或提供 **session.inviteAgent**(sessionKey, agentId)。被拉进来的 agent 从下一轮起参与轮转、可被 @；可选在 transcript 或 session 元数据中记录「入群时间」用于 UI 展示「xxx 加入了群聊」。 |
| 新成员看历史 | **获得群聊全部历史**：任一 participant（包括**刚被拉进来的 agent**）在被选中回复时，Gateway 加载的是**该群聊的同一份 transcript 的完整历史**（或受 context 长度限制的「最近 N 条」），作为 initialMessages 传给该 agent。即：新 agent 一进群就能「看到之前大家说了什么」，和人类进群后翻记录一致。 |
| 谁说了什么 | transcript 里每条 assistant 带 **senderAgentId**；**chat.history** 对该 session 返回完整（或分页）历史，且 assistant 条带 senderAgentId。这样 UI 与任何拿到历史的调用方（包括 agent）都能还原「谁在什么时候说了什么」。 |

**小结**

- **拉 agent 进群**：动态更新 participantAgentIds（sessions.patch 或 session.inviteAgent），新成员立刻参与后续轮转与 @。
- **获得群聊全部历史**：每次让某 agent 回复时，传入的 context = 该群聊 transcript 的**全量历史**（或最近 N 条）；新进的 agent 同样拿到这份历史，无需单独「同步」。  
- 实现上：loadTranscript(transcriptPath, entry.leafId) 已能加载到当前 leaf 的整条链；若需截断长度，在构造 initialMessages 时取最近若干条即可，但**不按「谁进群」做裁剪**——所有人看到的都是同一份群聊时间线。

### 3.2 群聊流程（按时间顺序）

下面是一次完整群聊从建群到展示的流程，便于实现时对齐各环节。

---

**阶段一：建群（创建群聊 session）**

| 步骤 | 谁 | 做什么 |
|------|-----|--------|
| 1 | 用户 | 在 Control UI 点「新建群聊」 |
| 2 | Control UI | 决定 sessionKey（如 `group:s-<ts>-<rand>` 或沿用 `agent:.u:group-<id>`），并调用 **session.createGroup**（或先 resolve 再 **sessions.patch**）传入：`sessionKey`、`participantAgentIds`（如 `[".u", "stock_learning"]`）、`leadAgentId`（如 `".u"`） |
| 3 | Gateway | 在 session store 中写入/更新该 sessionKey 对应的 SessionEntry：`sessionType: "group"`、`participantAgentIds`、`leadAgentId`；若该 key 尚无 transcript，则 initTranscript（或等首次发消息时由 resolveSession 创建） |
| 4 | Control UI | 打开该 session（选中的 conversation = 该 sessionKey），展示群聊窗口；此时历史可为空 |

**阶段二：用户发一条消息**

| 步骤 | 谁 | 做什么 |
|------|-----|--------|
| 5 | 用户 | 在群聊窗口输入内容，如「今天行情怎么样」或「@stock_learning 看看今天行情」 |
| 6 | Control UI | 调用 **chat.send**，传 `sessionKey`（当前群聊的 key）和 `message`；**不传 agentId**（由 Gateway 根据群聊规则决定） |

**阶段三：Gateway 路由与执行**

| 步骤 | 谁 | 做什么 |
|------|-----|--------|
| 7 | Gateway | **resolveSession**(sessionKey) 得到 entry、transcriptPath。若 `entry.sessionType === "group"`，进入群聊分支 |
| 8 | Gateway | 从 entry 取 `participantAgentIds`、`leadAgentId`；解析 message 中的 **@agentId**（正则或约定格式）。若命中且该 agentId 在 participantAgentIds 内，则本次执行 **agentId**；否则用 **leadAgentId**。若指定的 agent 未连接，可 503 或回退到 leadAgentId |
| 9 | Gateway | 用 **loadTranscript**(transcriptPath, entry.leafId) 加载该群聊的**同一份 transcript 的完整历史**（或受 context 长度限制的最近 N 条）。构造 **initialMessages**：所有 participant（含新拉进来的 agent）都拿到这份**群聊全部历史**；若 assistant 带 senderAgentId，可转成「给当前 agent 看的」格式（如在 content 前加 `[.u]: ` 等前缀），或原样传、由 system 说明「前文有多个 agent 的回复」 |
| 10 | Gateway | 按选定 agentId 找到连接（本机 runAgent 或远程 node.invoke），传入 message + initialMessages，**执行一轮** |
| 11 | 该 Agent | 在自己的 agentDir 下跑 runAgentTurn，可调自己的 tools（knowledge、cron 等），返回 text（+ toolCalls） |
| 12 | Gateway | 收到回复后，**appendTranscriptMessages**：先追加一条 **user**（当前 message），再追加一条 **assistant**，且该条带 **senderAgentId = 本轮执行的 agentId**。更新 entry.leafId、updatedAt，写回 session store |
| 13 | Gateway | 将 chat.send 的响应返回给 Control UI（含 text 等） |

**阶段四：展示**

| 步骤 | 谁 | 做什么 |
|------|-----|--------|
| 14 | Control UI | 收到 chat.send 成功后可刷新历史，或依赖 agent.run.done 等事件拉取新消息 |
| 15 | Control UI | 调用 **chat.history**(sessionKey) 拉取该 session 的 messages |
| 16 | Gateway | loadTranscript 后返回 messages；其中 **assistant 条带 senderAgentId**（若有） |
| 17 | Control UI | 若判断为群聊 session（entry.sessionType 或 participantAgentIds），则按条展示：user 显示为「用户」；assistant 按 **senderAgentId** 显示为「.u」「stock_learning」等，形成群聊时间线 |

---

**流程小结**

- **一个群聊 = 一个 session**，对应 **一份 transcript**。每条消息（user / assistant）顺序追加；assistant 带 senderAgentId 表示「谁说的」。
- **谁回复**：由 **leadAgentId + @agentId** 决定；只选**一个** agent 执行本轮，其回复带 senderAgentId 写回同一 transcript。
- **建群**：先有 sessionKey 和 SessionEntry（sessionType=group、participantAgentIds、leadAgentId），再发消息；建群可由 session.createGroup 或 sessions.patch 完成。
- **单聊兼容**：未设置 sessionType 或 sessionType 为 single 的 session，chat.send 仍按现有逻辑用 params.agentId 或 session 的 agentIdOverride；不写 senderAgentId 或写当前 agentId，UI 不展示多发送者。

### 3.3 会话类型与元数据

- **SessionEntry** 扩展（session-types / session store）：
  - **sessionType**：`"single"` | `"group"`（可选，默认 single，兼容现有）。
  - **participantAgentIds**：`string[]`，仅当 sessionType 为 group 时有效，表示参与该群聊的 agent 列表。
  - **leadAgentId**：`string`，可选；群聊中「默认由谁回复」当用户消息没有 @ 指定时。
- **sessionKey 约定**：群聊可用前缀区分，例如 `group:<id>` 或沿用现有 `agent:.u:group-<id>`；若沿用后者，则通过 SessionEntry.sessionType 和 participantAgentIds 识别为群聊。

### 3.4 Transcript 结构（谁说了什么）

- 当前 **StoredMessage**：`role`（user | assistant | system | toolResult）、content、toolCalls 等。
- 群聊需要区分 **assistant 是谁**：
  - 在 **StoredMessage** 上增加可选字段 **senderAgentId**：当 role 为 assistant 时，表示这条回复是哪个 agent 发的。
  - 存盘格式（JSONL message 条目）里 message 对象增加 `senderAgentId?: string`；chat.history 返回时带上该字段，Control UI 用其显示「.u」「stock_learning」等标签。
- 单 agent 会话不写 senderAgentId，或写当前会话的 agentId，UI 不展示多发送者即可。

### 3.5 群聊路由：谁回复（未指定时怎么办）

当用户（或某 agent）在**群聊 session** 发一条消息时，Gateway 需决定 **由哪个 agent 执行这一轮**。

**未指定（没有 @）时：默认只由一人回复**

- 推荐实现：**无 @ 则用 leadAgentId**，只选一个 agent 跑一轮，只追加**一条** assistant（带 senderAgentId）。  
- 这样语义清晰、实现简单：要么用户 @ 谁就谁回，要么由「主持人」leadAgentId 统一回。

**若希望「同时多人回复」**

- 可作为**扩展策略**：未指定时改为「所有 participant 都回复」——按 participantAgentIds 顺序（或并行）对每个 agent 跑一轮，每轮追加一条 assistant（带 senderAgentId），顺序写入同一 transcript。  
- 权衡：实现更复杂（多轮 LLM 调用、顺序与超时）、耗时与成本更高、UI 需支持同一 user 消息下多条 assistant 的展示（如折叠/展开）。  
- 若要做，可约定：session 或 message 上带可选标记（如 `replyMode: "all"`），仅在该标记时走「多人同时回复」；默认仍为 leadAgentId 单回复。

**策略小结**

| 策略 | 说明 |
|------|------|
| **leadAgentId** | 固定一个「主 agent」，所有未 @ 的消息都由其回复（**默认**）。 |
| **@agentId** | 消息内容解析 @agentId（如「@stock_learning 看看行情」），路由到对应 agent；若无 @ 则用 leadAgentId。 |
| **轮转** | 单轮轮转：未 @ 时按 participant 顺序选一人回复（本轮只一条）。 |
| **同时多人回复**（可选扩展） | 无 @ 时对每个 participant 各回一条，同一 user 下多条 assistant。**已实现**：Control UI 输入 `/all 消息` 或 chat.send 传 `replyMode: "all"`，Gateway 按 participantAgentIds 顺序依次执行每人一轮并追加 assistant（带 senderAgentId），返回 `{ allReplied: true, count }`。 |
| **发布任务 + 轮转直到完成**（已实现） | 一条「任务」消息触发多轮：participant 轮转执行，每人一轮、追加一条 assistant，直到回复含「任务完成」等标记或达到 maxRounds。chat.send 传 **replyMode: "task"**；Control UI 输入 **/task 任务内容**。详见下文。 |

推荐首期实现：**leadAgentId + @agentId**（未指定 = leadAgentId 单回复）；「同时多人回复」「任务轮转直到完成」按需再扩展。

**群聊发布任务：轮转直到完成任务**

另一种模式：用户（或主持 agent）在群聊里**发布一条任务**（如「整理一份本周行情报告」），然后 **participant 轮转执行**，每人一轮，**直到判定任务完成**再停止。

| 步骤 | 说明 |
|------|------|
| 1 | 用户发一条「任务消息」（或带标记如 `task: true`），Gateway 识别为「任务型」群聊消息。 |
| 2 | **轮转**：按 participantAgentIds 顺序，先由第一个 agent（如 leadAgentId）跑一轮，看到的是「任务 + 当前 transcript」；回复追加为一条 assistant（带 senderAgentId）。 |
| 3 | 下一名 agent 跑一轮，context 里已有上一个人的回复；再追加一条 assistant。如此轮转（A → B → A → B… 或 A → B → C → A…）。 |
| 4 | **结束条件**（满足其一即停止轮转）：① 某轮回复包含约定**完成标记**（如「任务完成」、或结构化 `{"done": true}`）；② 达到**最大轮数**（如每 agent 最多 2 轮）；③ leadAgentId 在轮到自己时**总结并声明完成**。 |
| 5 | 停止后，该条 user 任务下对应多条 assistant（.u、stock_learning、.u、…），形成「任务线程」；同一份 transcript，chat.history 按顺序返回，UI 按 senderAgentId 展示谁说了什么。 |

与「一条消息一人回」的区别：**一条 user 消息触发多轮 agent 回复**，轮转、直到完成任务。

**已实现**：chat.send 传 **replyMode: "task"** 或 **"taskRoundRobin"**；Control UI 输入 **`/task 任务内容`** 即触发。

- **流程**：先追加一条 user（任务内容），再按 participantAgentIds **轮转**（A→B→A→B…），每轮选当前 participant、用当前 transcript 调该 agent（远程 node.invoke），追加一条 assistant（带 senderAgentId），直到满足结束条件或达到最大轮数。
- **结束条件**（满足即停）：① 某轮回复内容匹配完成标记（正则：`任务完成`、`[done]`、`[任务完成]`、`done: true`）；② 达到 **maxRounds**（默认 20，可通过 params.maxRounds 指定，上限 50）。
- **返回**：`{ taskDone: true, rounds, text: 最后一轮回复 }`。UI 收到后拉 chat.history 展示整条任务线程（多条 assistant 按 senderAgentId 展示）。
- **执行方式**：本仓库 Gateway **不内嵌 runAgent**（无「本地 agent」），所有 agent 均由**独立进程**（如 `npm run agent`，AGENT_ID=xxx）连接 Gateway 后以**远程节点**方式执行；replyMode "all" 与 "task" 均只通过 **node.invoke.request** 调用这些已连接的 agent，不依赖 Gateway 进程内跑 LLM。

### 3.6 Gateway 行为（群聊）

- **resolveSession**：对 sessionKey 解析出 SessionEntry；若 entry.sessionType === "group"，则按群聊逻辑处理。
- **chat.send**（群聊分支）：
  1. 从 SessionEntry 取 participantAgentIds、leadAgentId。
  2. 解析 message 中的 @agentId（若约定支持）；决定本次执行的 agentId。
  3. 加载该 session 的 **同一份 transcript**（可能含 senderAgentId），构造 initialMessages；若 LLM 需要「谁说了什么」的上下文，可在每条 assistant 前加前缀（如 `[.u]: ...`）或通过 system 说明。
  4. 调用选定的 agent 执行一轮，回复写入 **同一 transcript**，且该条 assistant 带 **senderAgentId**。
- **chat.history**：若为该群聊 session，返回的 messages 中 assistant 条带 senderAgentId，Control UI 按发送者展示。

### 3.7 建群与成员

- **新建群聊**：Control UI 已有「新建群聊」入口，创建 `agent:.u:group-xxx` 这类 session，通过 **sessions.patch** 设置 sessionType=group、participantAgentIds、leadAgentId。
- **成员管理**：通过 sessions.patch 更新 participantAgentIds、leadAgentId（Gateway 已支持 allowedKeys）。
- **拉人进群（已实现）**：Control UI 群聊头部提供「邀请成员」按钮；弹层从 node.list 列出当前在线 agent，排除已在群内成员，选择后调用 **sessions.patch(sessionKey, { participantAgentIds: [...当前成员, 新 agentId] })** 追加成员，刷新会话列表后新成员出现在群成员标签中。

### 3.8 Control UI 群聊展示

- 群聊会话在左侧列为「群聊」项（已有 isGroupSession 等逻辑），点击打开同一 sessionKey。
- ChatPanel：若当前 session 为群聊（可由 sessions.preview/sessions.list 的 entry 带 sessionType 或 participantAgentIds 判断），则每条消息展示 **发送者**（User / agentId）；assistant 消息用 senderAgentId 显示为「.u」「stock_learning」等。
- 发送框可选：支持 @agentId 选择本次由谁回复（或由后端按 leadAgentId/@ 解析）。

---

## 四、实现清单（建议顺序）

### 4.1 委托到对方 Session（直接对话）

| 序号 | 项 | 说明 |
|------|----|------|
| 1 | gateway_skill：新增 **gateway_agent_send_to_session** | 参数 targetAgentId、message，可选 sessionKey；默认 sessionKey=`agent:<targetAgentId>:main`；调 chat.send；目标 agent 在该 session 内直接回复 |
| 2 | 文档 / SKILL.md | 说明委托 = 直接对话；定时任务与工具由 B 自己做（B 用自己的 cron 技能等），B 目录需有相应 skills 并跑 cron |

### 4.2 群聊 Session

| 序号 | 项 | 说明 |
|------|----|------|
| 1 | SessionEntry：sessionType、participantAgentIds、leadAgentId | session-types.ts 与 store 读写；sessions.patch 允许这些字段（或通过 session.createGroup 等） |
| 2 | StoredMessage：senderAgentId | session-transcript 存/读；append 时 assistant 可带 senderAgentId；chat.history 返回时带上 |
| 3 | chat.send 群聊分支 | 识别 group session，解析 @agentId 或用 leadAgentId，选一个 agent 执行，写入同一 transcript 并带 senderAgentId |
| 4 | chat.history 群聊 | 返回 messages 时 assistant 带 senderAgentId |
| 5 | sessions.patch 或 createGroup | 支持设置 sessionType、participantAgentIds、leadAgentId |
| 6 | Control UI：群聊消息展示发送者 | 根据 sessionType/participantAgentIds 及 history 中的 senderAgentId 显示 User / agentId 标签 |
| 7 | 新建群聊流程 | 创建 group session 并设置 participantAgentIds、leadAgentId（如 [".u", "stock_learning"]，leadAgentId ".u"） |
| 8 | replyMode "all" | 群聊下 chat.send 传 replyMode: "all"；Control UI /all 消息；多人各回一条 |
| 9 | replyMode "task" | 群聊下 chat.send 传 replyMode: "task"；Control UI /task 任务；轮转直到完成标记或 maxRounds |
| 10 | 拉人进群 | Control UI 群聊头部「邀请成员」+ sessions.patch 追加 participantAgentIds（已实现） |

---

## 五、与上一版设计的区别

- **上一版**：委托 = 在**当前** session 里用指定 agent 回一条（回复出现在当前 session）。**本版**：委托 = 发到**目标** session（如对方 main），由**目标 agent 在该 session 内直接回复**；回复写在那个 session 的 transcript，打开该 session 即看到。
- **术语**：窗口 = session 在 UI 上的呈现；**agent 直接在 session 回复** = 回复写入该 session 的 transcript。
- **上一版**：未设计群聊。**本版**：明确群聊 session 类型、participantAgentIds、leadAgentId、transcript 的 senderAgentId、路由规则（lead + @）及 UI 展示。

---

## 六、相关文档

- [Gateway 协议与实现](./protocol.md)
- [Agent 目录约定](../concepts/agent-directory.md)
- [Agent 运行机制](../runtime/agent-running.md)
