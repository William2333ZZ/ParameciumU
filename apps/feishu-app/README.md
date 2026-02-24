# monoU Feishu App

飞书 connector：通过飞书 WebSocket 接收消息，转发到 monoU Gateway 的 `connector.message.inbound`，由 Agent 生成回复后发回飞书。

## 配置

环境变量（建议放在项目根目录或本目录的 `.env`）：

| 变量 | 必填 | 说明 |
|------|------|------|
| `FEISHU_APP_ID` | 是 | 飞书应用 App ID |
| `FEISHU_APP_SECRET` | 是 | 飞书应用 App Secret |
| `GATEWAY_WS_URL` | 否 | Gateway WebSocket 地址，默认 `ws://127.0.0.1:9347` |
| `FEISHU_DOMAIN` | 否 | `feishu`（国内）或 `lark`（国际） |
| `CONNECTOR_ID` | 否 | 该实例在 Gateway 中的标识，默认 `feishu`。**多飞书时**第二个进程可设 `feishu_team_b` 等，便于区分与配置映射 |
| `CONNECTOR_DISPLAY_NAME` | 否 | 在 Control UI 中显示的接入名称（如「公司飞书」「客服机器人」）。不设则显示 connectorId。可从飞书开放平台应用名称复制后填入 |

## 飞书应用

1. 打开 [飞书开放平台](https://open.feishu.cn/app) 创建自建应用。
2. 在「凭证与基础信息」中获取 App ID、App Secret。
3. 在「事件订阅」中启用「接收消息」并配置 WebSocket（本 App 使用 WebSocket 模式）。
4. 在「权限管理」中开通：获取用户 userid、获取用户基本信息、获取与发送单聊/群聊消息、以应用的身份发消息等。

## Gateway 映射与默认 Agent

- 未配置映射时，消息由**默认 agent**（本机 `.u`）处理。
- 在 Control UI 或通过 RPC 调用 `connector.mapping.add`，可为某 connector 指定默认 agent，例如：  
  `{ connectorId: "feishu", agentId: ".u" }` 或 `{ connectorId: "feishu_team_b", agentId: "pilot" }`。

## 会话内切换 Agent

用户可在飞书里发指令，让**当前会话**后续消息由指定 Agent 回复：

- `/agent pilot`、`与 pilot 对话`、`和 pilot 对话`、`切换至 pilot`
- 切回默认：`/agent .u` 或 `与 .u 对话`

## 运行

1. 先启动 monoU Gateway（含 agent 能力）：在 monoU 根目录 `npm run build` 后 `node apps/gateway/dist/index.js`（或使用已有启动方式）。
2. 再启动本 App：

```bash
# 在 monoU 根目录
npm install
npm run build --workspace=@monou/feishu-app
# 或进入 apps/feishu-app 后 npm install && npm run build
node apps/feishu-app/dist/index.js
```

或从 `apps/feishu-app` 目录：

```bash
cd apps/feishu-app
npm install
npm run build
npm start
```

根目录的 `.env` 若已配置 `FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`GATEWAY_WS_URL`，从根目录执行 `node apps/feishu-app/dist/index.js` 时会自动加载。
