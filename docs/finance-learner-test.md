# finance_learner 测试流程说明

## 一、设计：Agent 怎么学习、怎么定时

### 1. 学习 (Learning)

- **来源**：用户对话中教的、或 agent 自己用 `web_search` + `knowledge_learn` / `knowledge_learn_from_urls` 写入知识库。
- **存储**：knowledge 技能读写 `KNOWLEDGE_WORKSPACE`（未设时默认 `./.u`）。**多 agent 时必须设成当前 agent 目录**，否则会写到 `.u`。
- **本仓库**：agent-client 在跑 cron 和 node.invoke 前会设 `process.env.KNOWLEDGE_WORKSPACE = agentDir`，保证 finance_learner 的知识写在 `agents/finance_learner/knowledge/`。

### 2. 定时任务 (Cron)

- **谁在跑**：每个 agent 进程内自己的 **runScheduler**，读的是**该 agent 的** `agents/<id>/cron/jobs.json`。
- **Gateway 的 cron**：Gateway 的 `cron.list` / `cron.run` 用的是 Gateway 自己的 CRON_STORE（默认 `.u/cron/jobs.json`），**不是** finance_learner 的。所以 Control UI 里「Cron」看到的是 .u 的任务；**不能**在 UI 里点「运行」来触发 finance_learner 的心跳。
- **触发方式**：到点后 agent 进程内的 scheduler 发现 job 到期 → 调用 `runAgentTurn(..., job.payload.message, { agentDir })` → agent 执行一轮（学习/汇报）→ 可选 `deliver` 推到飞书等。

### 3. 为何日志里看不到「job ran」或「onJobDue start」？

若**同时有多个 finance_learner agent 进程**在跑，它们共用同一份 `agents/finance_learner/cron/jobs.json`。调度器第一次循环时，**只有一个进程**会认为任务到期并执行 `store.run` + `onJobDue`，并把 `nextRunAtMs` 更新到未来；其他进程再次读文件时任务已「过期」，due 列表为空，就不会执行、也不会打「job ran」/「onJobDue start」。  
所以：**你 tail 的日志可能来自「没抢到任务」的进程**，看起来像 cron 没跑，但 `jobs.json` 里的 `lastRunAtMs` 会更新，说明**有进程执行成功了**。  
**建议**：测 cron 时只起**一个** finance_learner agent，并把 `state.nextRunAtMs` 设为 `0`，再观察该进程的日志，应能看到 `[cron] job ran`、`[cron] onJobDue start`、`[cron] onJobDue done`（或 `onJobDue failed`）。  
**单实例**：同一台机器上、同一 agent 目录（AGENT_DIR）只允许一个 agent-client 进程。启动时会在该目录下写 `.agent-client.pid`；若已存在且对应进程仍在跑，则本次启动会报错退出，避免多进程抢同一份 cron/知识库。

### 4. 当前 finance_learner 的定时任务

- **Heartbeat**：每 10 分钟一次，payload 为「先自主学习（web_search + knowledge_learn），再汇报」；无法学则汇报现状或 HEARTBEAT_OK。
- 这样**定时 = 定时学习 + 定时汇报**，而不只是「只汇报不学」。

---

## 二、曾发现的漏洞与修复

| 漏洞 | 说明 | 修复 |
|------|------|------|
| **KNOWLEDGE_WORKSPACE 未设** | knowledge 技能用 `process.env.KNOWLEDGE_WORKSPACE` 或默认 `cwd/.u`，多 agent 时会把知识写到 .u | agent-client 在 cron 与 node.invoke 前设 `KNOWLEDGE_WORKSPACE=agentDir`，finally 里恢复 |
| **心跳只汇报不学习** | 原 prompt 只让「汇报进展」，没有触发学习 | 将 cron 的 message 改为「先 web_search + knowledge_learn 学一条，再汇报」 |
| **Gateway cron 与 agent cron 混淆** | 以为在 UI 点 cron.run 能触发 finance_learner | 文档说明：agent 的 cron 只在 agent 进程内触发，验证看 agent 日志或 `agents/finance_learner/cron/jobs.json` 的 lastRunAtMs |

---

## 三、怎么跑完整测试

### 1. 启动

```bash
# 终端 1：Gateway（端口与 .env 中 GATEWAY_WS_URL 一致，如 9347）
GATEWAY_PORT=9347 npm run gateway

# 终端 2：finance_learner agent（会读 .env 的 GATEWAY_WS_URL，默认连 9347）
AGENT_ID=finance_learner AGENT_DIR=$(pwd)/agents/finance_learner node apps/gateway/dist/agent-client.js
```

或用脚本（会从 monoU 根目录的 .env 读 GATEWAY_WS_URL）：

```bash
AGENT_ID=finance_learner AGENT_DIR=$(pwd)/agents/finance_learner ./.u/skills/agent-creator/scripts/start-agent-client.sh
```

### 2. 验证定时学习与汇报

- **看 agent 日志**：应出现 `[cron] scheduler started`，到点后出现 `[cron] job ran`。
- **看 jobs 状态**：查看 `agents/finance_learner/cron/jobs.json`，应有 `lastRunAtMs`、`lastStatus`、`nextRunAtMs` 更新。
- **看知识库**：若 agent 执行了 knowledge_learn，`agents/finance_learner/knowledge/金融/` 下会有新 .md 或 learned.md 增加内容。

### 3. 想立刻触发一次（不等 10 分钟）

- **方法 A**：把 `jobs.json` 里该 job 的 `state.nextRunAtMs` 改成 `0`，保存后**重启 agent**，scheduler 第一次循环就会认为已到期并执行。
- **方法 B**：用 Control UI 或 TUI 选 finance_learner 会话，发一条：「请用 web_search 查一下市盈率，用 knowledge_learn 记进金融主题，然后回复你学了什么。」相当于手动触发一轮「学习+汇报」。

### 4. 可选：汇报推到飞书

在 `cron/jobs.json` 里给该 job 加上 `deliver: { connectorId: "feishu", chatId: "oc_xxx" }`（chatId 从飞书群会话取），到点执行完后会把汇报内容推到该群。

---

## 四、小结

- **学习**：用户教 + 定时任务里「先查再 knowledge_learn」；知识库路径由 KNOWLEDGE_WORKSPACE（agent-client 已按 agentDir 设置）决定。
- **定时**：仅在该 agent 进程内、按 `agents/finance_learner/cron/jobs.json` 执行；不能通过 Gateway 的 cron RPC 触发。
- **跑完整**：起 Gateway + finance_learner agent，看 agent 日志与 jobs.json、knowledge/金融/ 即可验证「定时学习+汇报」；要立刻测可改 nextRunAtMs 或发一条学习指令。
