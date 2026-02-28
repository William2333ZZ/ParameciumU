# ParameciumU 文档

ParameciumU（monoU）是一个**主权智能体平台**：每个智能体由一个**标准化目录**定义，身份、原则、记忆、知识、技能与定时任务都以你可控的文件形式存在。Gateway 与 Agent 在你自己的机器上运行；通过 Control UI、飞书或终端 TUI 连接。LLM 与人格数据不经过中心服务器——执行与数据都在边缘完成。

## 核心概念

- **Agent = 文件夹**。一个智能体就是一个目录（如 `.first_paramecium`），固定结构包含：`IDENTITY.md`、`SOUL.md`、`MEMORY.md`、`KNOWLEDGE.md`、`skills/`、`cron/jobs.json`。可版本管理、复制、迁移。
- **Gateway = 路由**。Gateway 是 WebSocket 服务端，负责消息、会话与 cron 的路由与转发；**不**运行 LLM，也不存储智能体状态。实际执行由已连接的 Agent 进程完成。
- **显式绑定智能体**。启动 Agent 时通过 `AGENT_ID` 和 `AGENT_DIR` 指定；没有默认智能体目录，由你指定「当前」智能体目录。

## 文档结构

| 章节 | 说明 |
|------|------|
| [快速开始](./start/getting-started.md) | 环境要求、构建、运行 Gateway、Agent、Control UI |
| [架构](./concepts/architecture.md) | Gateway、Agent 与智能体目录的关系 |
| [智能体目录](./concepts/agent-directory.md) | 目录结构、必备文件、技能及运行时加载方式 |
| [Gateway](./concepts/gateway.md) | 端口、环境变量、角色与协议概览 |
| [Cron](./concepts/cron.md) | 存储路径、任务结构、调度与载荷 |
| [应用](./runtime/apps.md) | Gateway、Agent、Control UI、TUI |
| [参考](./reference/env.md) | [环境变量](./reference/env.md)、[Gateway 协议](./reference/gateway-protocol.md)、[Cron 类型](./reference/cron-types.md) |

## 常用命令

```bash
# 构建
npm install && npm run build

# 终端 1：Gateway（默认 ws://127.0.0.1:9347）
npm run gateway

# 终端 2：Agent（必须设置 AGENT_DIR 与 AGENT_ID）
GATEWAY_URL=ws://127.0.0.1:9347 AGENT_ID=.first_paramecium AGENT_DIR=./.first_paramecium npm run agent

# 终端 3：Web 控制台
npm run control-ui
```

浏览器打开 http://localhost:5173，输入 Gateway URL 后即可对话。

## 许可证

MIT。
