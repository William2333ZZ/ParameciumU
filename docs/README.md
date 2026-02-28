---
title: ParameciumU
summary: 以「智能体标准化定义（基于文件夹）」为核心的主权智能体平台；定义即文件，编排在中心、执行在边缘。
read_when:
  - 向新用户介绍 ParameciumU
---

# ParameciumU

**ParameciumU** — 从单细胞起点持续进化、自生长的「另一个你」智能体平台。你是一只草履虫，可吸收营养进化、可复制繁殖。

以「智能体标准化定义（基于文件夹）」为核心：同一套定义跨平台运行，控制面与执行端分离，数据与人格在用户侧。默认智能体目录为 **.first_paramecium**（第一只草履虫）。

## 文档结构（按模块与主题）

文档组织参考「设计」与「使用」分离、按模块与案例查找：

- **入门 / 产品使用**：面向「怎么用」——快速开始、应用使用说明，独立于设计文档。
- **设计**：架构、协议、目录约定、Control UI 与 Gateway 等设计文档归档在侧栏「设计」下，便于做能力规划与实现对照。
- **运行 / 维护**：模块说明、Agent 运行机制、部署等。

| 主题 | 说明 |
|------|------|
| [入门](start/getting-started) | 从零构建、启动 Gateway / Agent / Control UI，常用命令 |
| [概念与设计](concepts/architecture) | 整体架构、Agent 目录约定、产品愿景与路线图、Gateway 协议、Control UI 设计等 |
| [Gateway](gateway/protocol) | WebSocket 协议、连接、会话、RPC 与事件 |
| [自动化](automation/cron) | 定时任务（Cron）、Heartbeat（在线证明与周期学习） |
| [运行](runtime/apps) | 应用说明（gateway、agent、control-ui、TUI 等）与模块（packages） |
| [Agent 运行机制](runtime/agent-running) | 目录加载、执行循环、Heartbeat 与 Cron 的代码级说明 |
| [Control UI](control-ui/design) | 界面与交互设计、节点能力接入 |
| [参考](reference/code-skill-design) | Code Engineer、Browser Node 等设计说明 |
| [维护](deploy-docs-site) | 文档站部署 |

## 工作原理

```
Connectors (Control UI / 飞书 / TUI)
         │
         ▼  connect、chat.send、cron.*、node.invoke
┌─────────────────────────────────────────────────────────────┐
│  Gateway（L2 控制面）                                          │
│  路由、会话、cron RPC；不执行 agent，仅转发给已连接的 agent 进程   │
└─────────────────────────────────────────────────────────────┘
         │
         ▼  node.invoke.request、agent.heartbeat
┌─────────────────────────────────────────────────────────────┐
│  Agent 进程（apps/agent）                                      │
│  加载 Agent 目录、runOneTurn、内嵌 Cron 调度、到点执行 Heartbeat │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│  L4 定义层（Agent 目录）                                       │
│  SOUL · IDENTITY · skills/ · memory/ · cron/jobs.json         │
└─────────────────────────────────────────────────────────────┘
```

## 快速开始

1. **构建**（monorepo 根目录）  
   `npm install` → `npm run build`

2. **准备 Agent 目录**（须显式指定，无默认）  
   `cp -r agents/sidekick .first_paramecium`

3. **启动 Gateway**  
   `npm run gateway`（默认 `ws://127.0.0.1:9347`）

4. **启动 Agent**（执行对话与定时任务所必需）  
   `GATEWAY_URL=ws://127.0.0.1:9347 AGENT_ID=.first_paramecium AGENT_DIR=./.first_paramecium npm run agent`

5. **打开 Control UI**  
   `npm run control-ui` → 浏览器 http://localhost:5173，输入 Gateway URL 连接

定时任务（Cron）已内嵌在 Agent 进程中，无需单独运行 `npm run cron:daemon`。详见 [快速开始](start/getting-started)。

## 项目结构速览

```
ParameciumU/
├── apps/           # gateway、agent、control-ui、TUI、feishu-app、sandbox-node
├── packages/       # 公共库（agent-core、cron、gateway、agent-from-dir 等）
├── agents/         # 示例智能体目录（与 .first_paramecium 同构）
├── .first_paramecium/  # 本机默认智能体目录（可选）
└── docs/           # 本文档
```

- **控制面**：`apps/gateway` — WebSocket 路由、会话、cron RPC。
- **执行端**：`apps/agent` — 连接 Gateway，加载 Agent 目录，执行对话与定时任务。
- **连接方**：Control UI、TUI、飞书等通过 Gateway 与 Agent 交互。

## 快速链接

- [快速开始](start/getting-started) — 构建、启动、常用命令
- [整体架构](concepts/architecture) — 四层抽象与代码划分
- [Gateway 协议](gateway/protocol) — 连接、会话与 RPC
- [定时任务与 Heartbeat](automation/cron) — Cron 内嵌在 Agent、无需 cron:daemon
