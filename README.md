# monoU — 主权智能体平台

**monoU** 是以「智能体 = 标准化文件夹」为核心的个人/主权智能体产品。你可以在自己的设备上运行 Gateway 与 Agent，通过 Control UI、飞书、终端 TUI 等连接层与智能体对话；人格、记忆与技能定义都在你可控的目录中，可版本化、可迁移。

控制面（Gateway）只做路由与转发，不跑 LLM、不存人格；执行在边缘（Agent 进程），数据与定义在用户侧。

[架构说明](docs/architecture.md) · [快速开始](docs/getting-started.md) · [应用说明](docs/apps.md) · [产品愿景与路线图](docs/vision-and-roadmap.md)

## 前置要求

- **Node.js ≥ 20**
- 使用 LLM 时：配置 `OPENAI_API_KEY` 或 `AIHUBMIX_API_KEY`、`AIHUBMIX_BASE_URL`（可复制根目录 `env.example` 为 `.env`）

## 快速开始（TL;DR）

```bash
# 克隆并构建
git clone <your-repo-url> monoU && cd monoU
npm install
npm run build

# 可选：初始化默认智能体目录 .u
npm run u

# 终端 1：启动 Gateway（默认 ws://127.0.0.1:9347）
npm run gateway

# 终端 2：启动 Agent 并连接 Gateway
GATEWAY_URL=ws://127.0.0.1:9347 AGENT_ID=.u AGENT_DIR=./.u npm run agent

# 终端 3：打开 Web 控制台或 TUI
npm run control-ui
# 或
npx u-tui
```

浏览器打开 http://localhost:5173，输入 Gateway URL（如 `ws://127.0.0.1:9347`）连接后即可与 Agent 对话。

仅本机对话、不接 Gateway 时，可直接运行：

```bash
npm run u
```

## 从源码开发

推荐使用 **npm** 或 **pnpm** 构建。

```bash
git clone <your-repo-url> monoU && cd monoU
npm install
npm run build

# 开发时：Gateway 与 Agent 各开终端
npm run gateway
# 另一终端
GATEWAY_URL=ws://127.0.0.1:9347 AGENT_ID=.u npm run agent
```

- 构建顺序：`packages`（shared → agent-core → skills → cron → agent-sdk → agent-template → llm-provider → agent-from-dir → tui → gateway），再 `apps`（gateway、agent）。
- Control UI 为 Vite 项目：`npm run control-ui` 开发，`npm run control-ui:build` 构建产物在 `apps/control-ui/dist`。

## 架构概览

```
┌─────────────────────────────────────────────────────────────────┐
│  L1 连接层 (Connectors)                                          │
│  Control UI · 飞书 · TUI · 未来企微/钉钉/API                      │
└─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────┐
│  L2 控制面 (Gateway)  — 路由 · 映射 · 会话 · 不执行业务、不存人格   │
│  ws://127.0.0.1:9347                                            │
└─────────────────────────────────────────────────────────────────┘
                                    │
          ┌─────────────────────────┼─────────────────────────┐
          ▼                         ▼                         ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  L3a Agent       │     │  L3b Node        │     │  L3c 远程调用    │
│  (Runner)        │     │  (沙箱/设备)      │     │  (node.invoke)   │
└────────┬────────┘     └────────┬────────┘     └─────────────────┘
         │                       │
         ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│  L4 定义层 — SOUL · IDENTITY · skills/ · memory/ · cron/ · 标准化  │
└─────────────────────────────────────────────────────────────────┘
```

- **L1**：所有人机界面与第三方入口统一为 Connector，与 Gateway 通过约定协议交互。
- **L2**：唯一中枢（`apps/gateway`）；无状态路由 + 轻量持久（mappings、sessions）；不跑 LLM、不跑 Cron。
- **L3**：执行端 = 多个 Node，每 Node 上可多只 Agent；Agent = 一个 L4 目录 + 一个 Runner 进程（`apps/agent`）。
- **L4**：智能体的唯一真相来源；符合约定的目录即可被任意兼容运行时加载、备份、迁移。

## 功能亮点

- **定义即文件** — 智能体 = 符合约定的文件夹（SOUL、IDENTITY、skills、cron 等）；可版本化、可迁移。
- **编排在中心、执行在边缘** — Gateway 只做路由与推送；会话、记忆、技能、定时在 Agent 端或独立 daemon 执行。
- **数据与人格在用户侧** — 身份、灵魂、记忆、技能在用户可控目录；产品不占有、不锁定。
- **多端接入** — Control UI（Web）、飞书（feishu-app）、终端 TUI（u-tui）；扩展新 Connector 见 [connector-guide](docs/connector-guide.md)。
- **多 Agent / 多 Node** — 多进程注册到同一 Gateway；node.invoke 支持沙箱等跨设备工具转发。
- **Cron 与心跳** — 定时任务存储与执行分离；可选 Heartbeat 与 cron daemon，详见 [heartbeat](docs/heartbeat.md)、[apps](docs/apps.md)。

## 常用命令

| 目的               | 命令 |
|--------------------|------|
| 全量构建           | `npm run build` |
| 启动 Gateway       | `npm run gateway` |
| 启动 Agent（连 Gateway） | `GATEWAY_URL=ws://127.0.0.1:9347 AGENT_ID=.u npm run agent` |
| 开发 Control UI    | `npm run control-ui` |
| 终端 TUI           | `npx u-tui` |
| 本机对话（不连 Gateway） | `npm run u` |
| 沙箱 Node          | `GATEWAY_URL=... npm run sandbox-node`（若已配置） |
| Cron 常驻调度器    | `npm run cron:daemon` |

更多环境变量与数据目录见 [apps.md](docs/apps.md) 与 [gateway.md](docs/gateway.md)。

## 仓库结构

```
monoU/
├── apps/           # 可执行应用：gateway、agent、control-ui、feishu-app、sandbox-node 等
├── packages/       # 复用库与协议：shared、agent-core、skills、cron、gateway、agent-from-dir 等
├── agents/         # 示例/测试智能体目录（与 .u 同构）
├── .u/             # 本机默认智能体（可选，可自建或复制 agents/sidekick）
├── docs/           # 文档
└── scripts/        # 构建、测试、发布脚本
```

## 与 OpenClaw 的关系

monoU **不依赖** OpenClaw 的代码或运行时，**不对齐**其协议。协议与实现为 monoU 自身需求服务；在架构清晰度、数据主权、多端接入与自动化能力上，规划为覆盖并超越同类方案。详见 [vision-and-roadmap.md](docs/vision-and-roadmap.md)。

## 文档索引

- [快速开始](docs/getting-started.md) — 构建、初始化 .u、启动 Gateway/Agent、Control UI、TUI、飞书、沙箱
- [架构](docs/architecture.md) — 四层抽象、仓库与代码划分、控制面职责
- [应用说明](docs/apps.md) — gateway、agent、control-ui、TUI、feishu-app、sandbox-node 环境变量与运行方式
- [Gateway](docs/gateway.md) — 端口、认证、数据目录、会话策略
- [产品愿景与路线图](docs/vision-and-roadmap.md) — 定位、设计原则、能力规划

## License

见仓库根目录 LICENSE 文件（如有）。
