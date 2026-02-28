---
title: "整体架构"
summary: "ParameciumU 四层抽象、packages 与 apps 划分、控制面与执行端职责边界"
read_when:
  - 首次了解项目结构
  - 扩展或对接 Gateway/Agent 时
---

# ParameciumU 整体架构

本文档描述 ParameciumU 的四层抽象、仓库与代码划分、以及控制面与执行端的职责边界。内容与当前 `packages/`、`apps/` 实现一致。产品定位与能力规划（含与 OpenClaw 的关系、不依赖不对齐的说明）见 [vision-and-roadmap.md](./vision-and-roadmap.md)。

## 一、设计原则

| 原则 | 含义 |
|------|------|
| **定义即文件** | 智能体 = 符合约定的文件夹（SOUL、IDENTITY、skills、cron 等）；可版本化、可迁移、不锁云与运行时。 |
| **编排在中心、执行在边缘** | 控制面（Gateway）只做路由、映射、推送；会话、记忆、技能、定时在 Agent 端执行。 |
| **数据与人格在用户侧** | 身份、灵魂、记忆、技能在用户可控目录；产品不占有、不锁定。 |
| **一层一事** | 每层职责单一，可替换、可扩展。 |
| **自进化在产品内** | 新 Agent、新 Skill 由运行中的 Agent 在自有目录内创建（如 agent-creator、skill-creator），不依赖平台发版。 |

## 二、四层抽象

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  L1 连接层 (Connectors)                                                       │
│  Control UI · 飞书 · TUI · 未来企微/钉钉/API                                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  L2 控制面 (Gateway)                                                          │
│  路由 · 映射 · 认证 · 会话 · 事件 · 主动推送 · 不执行业务、不存人格与记忆        │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
          ┌─────────────────────────────┼─────────────────────────────┐
          ▼                             ▼                             ▼
┌─────────────────┐           ┌─────────────────┐           ┌─────────────────┐
│  L3a 执行端      │           │  L3b Node        │           │  L3c 远程调用    │
│  (Agent Runner)  │           │  (设备/进程聚合)   │           │  (node.invoke)   │
│  单 Agent 目录   │           │  多 Agent 同设备  │           │  跨设备工具转发   │
└────────┬────────┘           └────────┬────────┘           └─────────────────┘
         │                             │
         ▼                             ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  L4 定义层 (Agent 文件夹)                                                     │
│  SOUL · IDENTITY · skills/ · memory/ · cron/ · 标准化、可迭代、可克隆          │
└─────────────────────────────────────────────────────────────────────────────┘
```

- **L1**：所有人机界面与第三方入口统一为 Connector；与 Gateway 通过约定协议交互，映射到 Agent/Node。
- **L2**：唯一中枢（apps/gateway）；无状态路由 + 轻量持久（mappings、sessions、transcripts）；不跑 LLM、不跑 Cron。
- **L3**：执行端 = 多个 Node，每 Node 上可多只 Agent；Agent = 一个 L4 目录 + 一个 Runner 进程（apps/agent）。node.invoke 用于跨设备工具转发。
- **L4**：智能体的唯一真相来源；任何兼容运行时只要读该目录即可复现同一智能体。

## 三、仓库与代码结构

### 3.1 根目录

```
ParameciumU/
├── apps/           # 可部署、可执行的应用（每个能独立 run/build）
├── packages/       # 被复用的库与协议（无独立进程）
├── agents/         # 示例/测试智能体目录（与 .first_paramecium 同构）
├── .first_paramecium/  # 本机默认智能体（第一只草履虫，可选）
├── docs/           # 文档
├── scripts/        # 构建、测试、发布脚本
└── [根配置]        # package.json、tsconfig、biome、env.example
```

### 3.2 packages 分层（由底向上）

| 层级 | 包名 | 职责 | 依赖 |
|------|------|------|------|
| 基础 | @monou/shared | 类型、ID、通用工具 | 无 |
| 核心 | @monou/agent-core | 状态、消息、单轮 loop 抽象 | shared |
| 能力 | @monou/skills | 技能加载、格式化为 prompt、脚本工具 | 无 |
| 能力 | @monou/cron | 定时任务调度与存储 | 无 |
| 能力 | @monou/llm-provider | 多模型注册与 stream 抽象 | 无 |
| 整合 | @monou/agent-sdk | createAgent、runTurn，接 skills + LLM | agent-core, skills |
| 定义 | @monou/agent-template | 模板目录、ensureAgentDir、getAgentDir、getAgentSkillDirs | 无 |
| 从目录加载 | @monou/agent-from-dir | buildSessionFromU、createAgentContextFromU | agent-template, agent-sdk, llm-provider |
| 连接 | @monou/gateway | 协议类型、callGateway、RPC/事件约定 | 无 |
| 交互 | @monou/tui | 终端 UI 组件与会话 | 无 |

原则：**下层不依赖上层**。agent-core 不依赖 gateway；gateway 不依赖 agent-sdk。

### 3.3 apps 按角色划分

| 应用 | 角色 | 说明 |
|------|------|------|
| gateway | L2 控制面服务端 | WebSocket：路由、会话、cron RPC；**只做转发**，将 agent/chat 请求转发给已连接的 agent 进程，不启动、不执行 agent。 |
| agent | 启动 Agent 的 app | 连 Gateway、注册 agentId/deviceId、收 node.invoke 派发、用 agent-from-dir 跑 runTurn、回传；含 heartbeat 定时（见 [Heartbeat](../automation/heartbeat.md)）。 |
| control-ui | L1 Connector（Web） | 连 Gateway，全景拓扑、会话、设置、对话。 |
| TUI（u-tui） | L1 Connector（TUI） | 终端内对话与 Cron 面板；对话可走本地 agent-from-dir 或 Gateway。 |
| feishu-app | L1 Connector（飞书） | 飞书 WebSocket 收消息 → connector.message.inbound → 回复发回飞书；支持 connector.message.push 主动推送。 |
| sandbox-node | L3 Node（沙箱） | 以 role=node 连 Gateway，声明 capabilities: ["sandbox"]；在隔离 workspace 内执行 system.run / system.which，供 node.invoke 调用。 |

### 3.4 Agent 独立启动

- **Agent 以独立进程运行**：执行 agent 对话需单独启动 `apps/agent` 并连接 Gateway；Gateway 不启动、不内嵌 agent。
- **推荐**：终端 1 起 `npm run gateway`，终端 2 起 `GATEWAY_URL=... AGENT_ID=.first_paramecium npm run agent`，浏览器开 Control UI 或运行 TUI。

## 四、控制面（L2）职责边界

Gateway **做**：

- WebSocket 连接与身份（agent / node / operator）
- 路由：connector → session → agent/node
- 会话管理（sessions.list / preview / patch）；未指定 sessionKey 时按时间新建
- agent / chat.send / chat.abort / agent.wait，以及 runId 与流式事件
- cron 的 list/add/update/remove/run（读写 CRON_STORE 或由 Agent 端提供）
- node.list、node.invoke 转发（请求到 Node，结果回传）
- connector.mapping 的增删与持久化
- 认证（token/password）、TLS、Session 过期策略（daily/idle）

Gateway **不做**：

- 不跑 LLM、不跑 Agent 循环
- 不在 agent 目录存会话文件（会话均由 .gateway 管理）
- 不存 SOUL/IDENTITY/skills 内容、不存用户记忆与人格数据
- 不执行业务定时器（Cron 触发在 Agent 端或独立 daemon）

## 五、定义层（L4）标准化清单

| 条目 | 路径/约定 | 说明 |
|------|-----------|------|
| 灵魂 | SOUL.md | 原则、边界、气质；每轮注入 system prompt。 |
| 身份 | IDENTITY.md | 名字、类型、可对外展示的档案。 |
| 技能 | skills/&lt;name&gt;/ | 每技能：SKILL.md、scripts/、references/；可增删改。 |
| 长期记忆 | memory/、MEMORY.md | 由 memory 类技能使用。 |
| 知识库 | KNOWLEDGE.md、knowledge/ | 由 knowledge 技能使用；检索、自学习、按主题/知识点组织。 |
| 定时 | cron/jobs.json | 由 cron 技能使用；Gateway 可读可写（RPC）。 |

**会话**：不放在 agent 目录。由控制面管理：元数据在 `.gateway/sessions/sessions.json`，transcript 在 `.gateway/sessions/transcripts/`。未指定 sessionKey 时按时间新建 key。

凡符合上述约定的目录，即「ParameciumU 兼容智能体」；可被任意兼容运行时加载、备份、迁移、克隆。详见 [agent-directory.md](./agent-directory.md)。

**Agent 运行机制**（目录加载、执行循环、Heartbeat）的代码级说明见 [agent-running.md](../runtime/agent-running.md)。

## 下一步

- 产品定位与能力规划：[vision-and-roadmap](./vision-and-roadmap.md)
- Gateway 协议与实现：[Gateway](../gateway/protocol.md)
- Agent 目录约定：[Agent 目录](./agent-directory.md)
- 快速开始：[start/getting-started](../start/getting-started.md)
- 运行机制详解：[agent-running](../runtime/agent-running.md)
