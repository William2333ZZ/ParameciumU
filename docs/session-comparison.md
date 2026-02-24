# Session 概念对比：pi coding-agent、OpenClaw、monoU

三者都有「session」概念，但归属、存储和用途不同。本文说明其关系，便于在 monoU 中理解「和 gateway 有关的 session」与 pi/OpenClaw 的差异。

---

## 一、pi coding-agent 的 Session

**定位**：本地、单进程内的**对话历史与树形分支**，面向 TUI/CLI 的「继续上次会话 / 分支 / 恢复」。

- **SessionManager**：管理一条会话 = 一个 **JSONL 文件**（append-only），条目通过 `id`/`parentId` 形成**树**；有「当前叶节点」指针，支持分支、fork、navigate。
- **存储**：`~/.pi/agent/sessions/--<cwd-path>--/<timestamp>_<uuid>.jsonl`，按工作目录分目录。
- **AgentSession**：对外的会话对象，提供 `prompt()`、`steer()`、`followUp()`、`newSession()`、`switchSession()`、`fork()`、`compact()` 等；内部持有一个 SessionManager（或 in-memory 不落盘）。
- **特点**：
  - **本地优先**：会话文件在跑 pi 的机器上，不依赖中心服务。
  - **树形历史**：可回溯到某条消息再分支，适合「试不同回复」。
  - **无 Gateway**：RPC 模式可连到别的进程，但 session 本身仍是「本进程 + 本地文件」语义。

---

## 二、OpenClaw 的 Session

**定位**：**由 Gateway 拥有**的会话状态与 transcript，多端（macOS 应用、WebChat、多用户 DM）都向 Gateway 查列表与历史。

- **来源**：文档明确写 **「Gateway is the source of truth」**；UI 不读本地 JSONL，只调 Gateway 的 sessions 相关 API。
- **存储**：
  - 元数据：`~/.openclaw/agents/<agentId>/sessions/sessions.json`（`sessionKey -> { sessionId, updatedAt, ... }`）。
  - 对话内容：`~/.openclaw/agents/<agentId>/sessions/<SessionId>.jsonl`。
- **sessionKey**：如 `agent:<agentId>:main`（主 DM）、`agent:<agentId>:<channel>:group:<id>`（群组）等；`dmScope` 控制多用户时是否按 peer/channel 隔离。
- **特点**：
  - **中心化**：会话状态、token 计数等都在 Gateway 上。
  - **多端一致**：同一 sessionKey 在哪端看到的都是同一会话。
  - **多用户/多会话**：main / group / cron / hook / node 等种类，并有 session 工具（sessions_list、sessions_send 等）给 agent 用。

---

## 三、monoU 的 Session（与 Gateway 绑定）

**定位**：与 **apps/gateway** 绑定，由 Gateway 持有会话元数据与 transcript；agent 作为已连接客户端执行 turn，不自己「拥有」会话文件。

- **存储**（见 [gateway.md](./gateway.md)）：
  - 元数据：`.gateway/sessions/sessions.json`。
  - 单条会话内容：`.gateway/sessions/transcripts/<sessionKey>.json`。
- **sessionKey**：未指定时新建，形如 `agent:.u:s-<timestamp>-<random>`；connect 时可带 `sessionKey` 做默认绑定。
- **RPC**：`sessions.list`、`sessions.preview`、`sessions.patch`、`sessions.delete`；`agent` / `chat.send` 可带 sessionKey/sessionId；消息以 `/new` 或 `/reset` 开头会新建 session 再执行。
- **特点**：
  - **和 Gateway 强相关**：会话的「存在」与「内容」都由 Gateway 管理；agent 只负责执行并回传结果，由 Gateway 写 transcript。
  - **无树形分支**：当前是「单线 transcript」，没有 pi 的 id/parentId 树和 fork。
  - **与 OpenClaw 类似**：都是「Gateway 为真相源」、sessionKey + transcript 文件；monoU 未实现 dmScope/多 channel 等，但模型一致。

---

## 四、关系小结

| 维度         | pi coding-agent              | OpenClaw                     | monoU                         |
|--------------|------------------------------|------------------------------|-------------------------------|
| **会话归谁** | 本进程 + 本地文件            | Gateway                      | Gateway                       |
| **存储位置** | ~/.pi/agent/sessions/...     | ~/.openclaw/agents/.../sessions/ | .gateway/sessions/...     |
| **结构**     | 树（id/parentId，可分支）     | 线性 transcript + 元数据     | 线性 transcript + 元数据       |
| **多端/多用户** | 无（单机 TUI）             | 有（dmScope、多 channel）    | 可扩展，当前较简              |
| **与 Gateway** | 无                           | 有，Gateway 是唯一数据源     | 有，session 与 gateway 绑定   |

- **pi 的 session**：本地、树形、单机编辑/分支；和「有没有 Gateway」无关。
- **OpenClaw 的 session**：Gateway 中心、多端一致、多用户/多会话；monoU 的 session 在设计上与之**同族**（Gateway 拥有、sessionKey + transcript）。
- **monoU 的 session**：实现上就是「和 gateway 有关的 session」——由 apps/gateway 存 sessions.json 与 transcript，agent 通过 RPC 执行 turn，不直接读写 pi 式 session 文件；若未来要做「类 pi 的本地树形会话」，需在 monoU 里另建一层（例如本地 session 管理器），再通过 gateway 的 sessionKey 做关联或同步，而不是把 pi 的 SessionManager 直接当 monoU 的 session 用。

---

## 五、在 monoU 里怎么用「session」

- **通过 Gateway 的会话**：用 `sessions.list` / `sessions.preview` 查列表与摘要；`agent` / `chat.send` 时带 `sessionKey` 或交给 Gateway 按策略解析（新建/续用）；会话内容与生命周期由 Gateway 管理。
- **仅本地、无 Gateway**：例如脚本或单机工具，可以只用 agent-from-dir + createAgentContextFromU 的 state（内存里的 messages），不建 sessionKey、不写 transcript；这时没有「monoU session」，只有一次性的对话 state。
- **和 pi 的对应**：pi 的「打开一个 session 文件继续聊」在 monoU 里对应「用某个 sessionKey 调 chat.send / agent」；pi 的 fork/树形分支在 monoU 当前没有直接等价，需要的话要在 Gateway 或上层做「复制/分支会话」的 API 与存储设计。
