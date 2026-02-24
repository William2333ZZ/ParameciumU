# Gateway 测试脚本说明

## test-gateway.ts（需先启动 Gateway）

对已运行的 Gateway 做 RPC 用例检查。

```bash
# 终端 1
npm run gateway

# 终端 2
npm run test:gateway
```

可选环境变量：`GATEWAY_URL=ws://127.0.0.1:18790`（默认 9347）。

覆盖：health、connect、cron.list、cron.status、agents.list、sessions.list、node.list、status。

## test-gateway-e2e.ts（自启子进程）

先构建，再在随机端口启动 Gateway 子进程，跑完用例后结束进程。适合 CI 或本地一键验证。

```bash
npm run test:gateway-e2e
```

覆盖：health、cron.list、agents.list、node.list、cron add/list/remove 回合。

## 场景测试（用 .u 创建新 agent 后由新 agent 执行任务）

若有「清空 agents/.gateway → 启动 Gateway → 启动 .u → 用 .u 创建新 agent（如 stock_learning）→ 执行汇报/cron/chat」的场景测试，须满足：

- **执行任务的是新 agent**：所有汇报、cron 技能、chat.history 等 RPC 必须使用**新创建的 agent**（如 `agentId: "stock_learning"`、其 `deviceId`），而不是 .u。
- **定时任务归属新 agent**：每 10 分钟汇报等 cron 任务应写入**新 agent 的 cron 存储**（如 `agents/stock_learning/cron/jobs.json`），由新 agent 进程的 runScheduler 执行，而不是写入 Gateway 默认（.u）的 store。
- **断言针对新 agent**：如 `agents/<新 agent id>` 目录存在、`agents.list` 中出现该 agent、`skills.status(agentId: 新 id)`、向该 agent 发汇报请求并检查其回复、`chat.history` 使用与该 agent 对话的 sessionKey 并断言 `messages` 来自该会话。
