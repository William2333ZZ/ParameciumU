# Feishu Node

以 **role=node** 连接 Gateway，声明 `capabilities: ["feishu"]`，处理 `node.invoke.request`（如 `feishu.send`）；同时保留 Connector + 飞书 WebSocket：收消息走 `connector.message.inbound`，收 `connector.message.push` 回发飞书。

Agent 可通过 `gateway_nodes_list` 发现本节点，并用 `gateway_node_invoke("feishu-1", "feishu.send", { receiveId, receiveIdType?, text, replyToMessageId? })` 发飞书消息。

## 配置

环境变量（建议放在项目根或本目录的 `.env`）：

| 变量 | 必填 | 说明 |
|------|------|------|
| `FEISHU_APP_ID` | 是 | 飞书应用 App ID |
| `FEISHU_APP_SECRET` | 是 | 飞书应用 App Secret |
| `GATEWAY_WS_URL` / `GATEWAY_URL` | 否 | Gateway WebSocket，默认 `ws://127.0.0.1:9347` |
| `FEISHU_NODE_ID` | 否 | 节点 ID，默认 `feishu-1`（供 gateway_node_invoke 目标） |
| `FEISHU_DOMAIN` | 否 | `feishu`（国内）或 `lark`（国际） |
| `CONNECTOR_ID` | 否 | Connector 标识，默认 `feishu` |
| `CONNECTOR_DISPLAY_NAME` | 否 | Control UI 展示名 |

## node.invoke 命令

- **feishu.send**：`params`: `{ receiveId, receiveIdType?: "chat_id"|"open_id", text, replyToMessageId? }` → 发送文本到指定会话。

## 运行

```bash
# 从仓库根
npm run build --workspace=@monou/feishu-node
node apps/nodes/feishu-node/dist/index.js
# 或
npm run feishu-node
```

从 `apps/nodes/feishu-node` 目录：

```bash
cd apps/nodes/feishu-node
npm install && npm run build && npm start
```

根目录 `.env` 若已配置飞书与 Gateway，从根目录执行时会自动加载。
