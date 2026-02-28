---
title: "Gateway 概述"
summary: "ParameciumU Gateway 的角色、与 Agent/Node 的关系、协议与运行入口"
read_when:
  - 首次了解 Gateway 在架构中的位置
  - 需要运行或对接 Gateway 时
---

# Gateway 概述

Gateway 是 ParameciumU 的 **L2 控制面**：唯一常驻 WebSocket 服务端，负责连接、路由、会话、RPC 与事件推送；**不执行** agent 对话、不跑 LLM、不跑 Cron 执行。

## 是什么

- **apps/gateway**：常驻进程，默认绑定 `127.0.0.1:9347`（可配置 `GATEWAY_PORT`、`GATEWAY_HOST`）。
- **packages/gateway**：协议类型与客户端调用方式（如 `callGateway`）；与「谁在跑服务端」解耦。
- 客户端：Control UI、TUI、apps/agent、feishu-app、sandbox-node 等通过 WebSocket 连接，首条消息为 **connect**（带 role、agentId/deviceId、可选 token/password）。

## 职责边界

| 做 | 不做 |
|----|------|
| connect、路由、会话管理（sessions.*） | 不跑 LLM、不跑 Agent 循环 |
| cron.* RPC（读写 cron store） | 不执行业务定时器（Cron 执行在 Agent 进程内） |
| agent / chat.send / agent.wait / chat.abort | 不存 SOUL/IDENTITY/skills、不存用户记忆与人格 |
| node.list、node.invoke 转发 | 会话由 .gateway 管理，不写在 agent 目录 |
| connector.mapping.*、connector.message.push | |

## 如何运行

```bash
# 从 monorepo 根目录
npm run build
npm run gateway

# 指定端口
GATEWAY_PORT=18790 npm run gateway
```

环境变量：`GATEWAY_PORT`、`GATEWAY_HOST`、`GATEWAY_DATA_DIR`、`CRON_STORE`、`GATEWAY_TOKEN`/`GATEWAY_PASSWORD` 等，详见 [应用说明 (apps)](../runtime/apps.md)。

## 下一步

- [Gateway 协议与实现](./protocol.md) — 连接、RPC、会话、事件与扩展
- [多智能体互动](./multi-agent.md) — 当前智能体发现其他智能体并委托/转交与用户互动
- [应用说明 (apps)](../runtime/apps.md) — gateway 环境变量与数据目录
- [整体架构](../concepts/architecture.md) — 四层抽象与控制面边界
