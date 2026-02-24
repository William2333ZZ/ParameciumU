# monoU Session 树形控制设计（pi 式）

在保持「Gateway 拥有 session」的前提下，为 monoU 增加 pi 式的会话控制：**树形历史、当前叶节点（leaf）、分支（fork）、切换分支（navigate）**。本文给出实现思路与分步方案。

---

## 一、目标能力（对齐 pi）

| 能力 | pi | monoU 目标 |
|------|----|------------|
| 会话 = 树 | 每条记录 id + parentId，leaf 指针 | 同一 sessionKey 下 transcript 存树形条目，SessionEntry 存 leafId |
| 追加消息 | 新条目 parentId = 当前 leaf | 新消息作为 leaf 的子节点追加，并更新 leafId |
| 分支 | fork(sessionFile) 或从某 entry 开新会话 | 新 sessionKey，transcript 复制「根到某 entry」或「根到当前 leaf」 |
| 切换分支 | navigate(entryId)：leafId = entryId，下次回复接在该节点后 | RPC 指定新 leafId，后续 append 以该节点为 parent |
| 列表 / 预览 | SessionManager.list、按 cwd/路径 | 已有 sessions.list / sessions.preview，可带 tree 摘要 |
| 新建 / 切换会话 | newSession、switchSession(path) | 已有 sessionKey 解析 + /new /reset |

---

## 二、数据模型

### 2.1 SessionEntry（sessions.json 中每条）

在现有字段基础上增加：

- **leafId**（可选）：当前「叶节点」条目 id。省略时表示线性会话（兼容旧数据），等价于「最后一条消息的 id」。
- 现有 sessionId、updatedAt、transcriptPath、displayName 等不变。

### 2.2 Transcript 格式（两种，兼容）

**A. 现有格式（线性，保持兼容）**

- 文件内容：单个 JSON 数组 `StoredMessage[]`。
- 语义：顺序即历史，无 id/parentId；**leafId 不存或忽略**，跑 agent 时用整段数组，写回时 append 到数组末尾。

**B. 树形格式（新）**

- 文件内容：**JSONL**，每行一个 JSON 对象。
- 首行：会话头，例如 `{ "type": "session", "version": 2, "id": "<sessionId>", "cwd": "...", "createdAt": "..." }`。
- 其余行：条目，至少包含 `id`、`parentId`（根为 null 或 ""）、`type`（如 "message"）、时间戳；type=message 时含 role、content 等（可复用 StoredMessage 结构）。
- 约定：同一文件中 id 唯一；parentId 指向本文件内某条 id；**当前叶节点**由 SessionEntry.leafId 指定（不写进 transcript 文件，只在 store 里）。

检测方式：读文件首字符或首行；若为 `[` 则按 A 解析；若为 `{` 则按 B 解析（首行 session header，其余按行 parse）。

### 2.3 树形条目类型（最小集）

与 pi 对齐可只做消息与标签，例如：

- **session**：头，仅一行。
- **message**：`{ type: "message", id, parentId, timestamp, message: StoredMessage }`。
- **label**（可选）：`{ type: "label", id, parentId, targetId, label }`，用于 UI 给某节点打标签。

先实现 message 即可，label 可后加。

---

## 三、Gateway 侧改动

### 3.1 存储层（apps/gateway）

- **session-types.ts**：`SessionEntry` 增加 `leafId?: string`。
- **session-transcript.ts**（或新文件 session-transcript-tree.ts）：
  - **loadTranscript**：若检测到格式 B，则解析 JSONL，按 id 建 map，根据 SessionEntry.leafId（或缺省时取最后一条）得到「根到 leaf」的路径，返回 `StoredMessage[]` 供 agent 用。
  - **saveTranscript**：若当前为格式 B，则仅 **append** 新消息为一行 JSONL（新 entry 的 parentId = 当前 leafId，新 id 生成），并返回新 id；然后由上层把新 id 写回 SessionEntry.leafId。
  - 若当前为格式 A，保持现有「整段 load → 内存 append → 整段 save」。
- **session-store.ts**：resolveSession 在创建新 session 时不必设 leafId；若从树形 transcript 读入且无 leafId，可设 leafId = 最后一条 message 的 id（便于后续一律走树逻辑）。

### 3.2 RPC（packages/gateway + apps/gateway）

在现有 sessions.list / sessions.preview / sessions.patch / sessions.delete 基础上增加：

- **sessions.getTree**（或 **sessions.entries**）  
  - params: sessionKey（必填）。  
  - 返回：该 session 的 transcript 树形结构，例如 `{ entries: { id, parentId, type, message?, timestamp }[], leafId }`，供 UI 画树、选节点。

- **sessions.navigate**  
  - params: sessionKey, entryId。  
  - 行为：校验 entryId 属于该 session 的 transcript，则把该 SessionEntry.leafId 设为 entryId；返回 ok。  
  - 之后 chat.send / agent 的下一轮将从该 leaf 后追加（实现「从某条回复再续」）。

- **sessions.fork**  
  - params: sessionKey, optional entryId（不传则从当前 leaf 分支）。  
  - 行为：新建一个 sessionKey（如 `agent:.u:s-<ts>-<rand>`），transcript 复制「根到 entryId（或当前 leaf）」的路径上的条目（JSONL 只复制这些行，或新文件写一份等价内容），新 session 的 leafId = entryId（或当前 leaf）。  
  - 返回：新 sessionKey、新 SessionEntry。  
  - 语义：在新会话里「从这一点开始新分支」，不修改原会话。

- **sessions.getPath**（可选）  
  - params: sessionKey。  
  - 返回：从根到当前 leaf 的 message 列表（与 agent 跑 turn 时用的线性列表一致），便于 UI 显示「当前分支」内容。

协议层（packages/gateway）的 GATEWAY_METHODS 增加上述方法名；apps/gateway 的 handlers 里实现，并调用上述存储/transcript 逻辑。

### 3.3 Agent 执行（agent-runner）

- **加载**：继续用现有 loadTranscript(transcriptPath) → StoredMessage[]；若底层改为「从树中取 root→leaf 路径」，则 loadTranscript 内部根据 transcript 格式 + SessionEntry.leafId 返回该路径的 messages 即可，对 agent-runner 仍是一份线性数组。
- **写回**：跑完一轮后，若 transcript 为树形，则不再「整段覆盖」：只把本轮新产生的 messages 逐条 append 为 JSONL 新行（每条 parentId = 当前 leafId，生成新 id），并把**最后一条新消息的 id** 写回 SessionEntry.leafId（updateSessionEntry(storePath, sessionKey, { leafId: newLeafId })）；若为线性格式则保持「load 全量 → append → save 全量」。

---

## 四、兼容与迁移

- **旧会话**：transcript 仍是 JSON 数组，不写 leafId；行为与现在完全一致（线性，无树）。
- **新会话**：可在创建时选择「用树形」：即创建 transcript 时写 JSONL session header + 之后 message 按行 append；SessionEntry 有 leafId。
- **可选**：提供「迁移」接口或脚本：把某 session 的 JSON 数组转成 JSONL 树（每条 message 顺序 parent 指向前一条），并设 leafId 为最后一条，便于老会话也能用 navigate/fork。

---

## 五、实现顺序建议

1. **只改 SessionEntry + 内存/API，不改文件格式**  
   在 SessionEntry 里加 leafId；transcript 仍为线性 JSON；sessions.getTree 返回「把当前 messages 当成单链树」的 entries（每条 parentId 指向前一条），sessions.navigate 只允许选「已有 index」对应的 id，fork 复制整份 JSON 到新 sessionKey。这样先打通 RPC 与 UI 行为，再换存储。

2. **Transcript 支持 JSONL 树格式**  
   新增「树形 transcript」的读写：load 时根据 leafId 解析出 root→leaf 的 StoredMessage[]；save 时只 append 新行并回写 leafId。新 session 默认用树形；旧 session 保持线性。

3. **Agent-runner 写回逻辑**  
   若 transcript 为树形：跑完 turn 后只 append 新消息行并更新 SessionEntry.leafId；否则保持整段 save。

4. **可选**：label 条目、compaction 条目（与 pi 的 compaction entry 对齐）等，再按需加类型与 RPC。

---

## 六、小结

- **Session 仍由 Gateway 拥有**，sessionKey、sessions.json、transcript 路径不变。
- **树形**通过「transcript JSONL 条目 + SessionEntry.leafId」表达；**线性 transcript 保留**，兼容旧会话。
- **pi 式控制**：navigate = 改 leafId；fork = 新 sessionKey + 复制根到某 entry 的路径；getTree/getPath = 读 transcript 并按树/路径返回；追加消息 = 新 entry 的 parentId = leafId，再更新 leafId。
- 实现时先做「线性 + leafId + 最小 RPC」，再做「JSONL 树存储」与 agent-runner 的 append-only 写回，可逐步落地且不破坏现有行为。
