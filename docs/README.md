# monoU 文档

**项目代号：ParameciumU** — Paramecium（草履虫）× U（另一个你）：从单细胞起点持续进化、自生长的「另一个你」智能体平台。

monoU 是以「智能体标准化定义（基于文件夹）」为核心的主权智能体产品：同一套定义跨平台运行，控制面与执行端分离，数据与人格在用户侧。**monoU 不依赖 OpenClaw，协议与实现独立演进，能力规划为覆盖并超越同类方案。**

## 文档索引

| 文档 | 说明 |
|------|------|
| [vision-and-roadmap.md](./vision-and-roadmap.md) | **产品定位与能力规划**：与 OpenClaw 的关系、设计原则、能力域与路线图 |
| [architecture.md](./architecture.md) | 整体架构：四层抽象、packages 与 apps 划分、设计原则 |
| [packages.md](./packages.md) | packages 下各模块的职责、依赖与用法 |
| [apps.md](./apps.md) | apps 下各应用的职责、运行方式与环境变量 |
| [gateway.md](./gateway.md) | Gateway 协议、服务端与客户端、会话与 RPC |
| [agent-directory.md](./agent-directory.md) | Agent 目录约定（.u 同构）、SOUL/IDENTITY/skills/memory/knowledge/cron |
| [getting-started.md](./getting-started.md) | 快速开始：构建、启动 Gateway、启动 Agent、Control UI |

## 项目结构速览

```
monoU/
├── apps/           # 可执行应用：gateway、agent、control-ui、TUI（u-tui）、feishu-app、sandbox-node
├── packages/       # 公共库：shared、agent-core、skills、cron、agent-sdk、agent-template、
│                   #        agent-from-dir、llm-provider、tui、gateway
├── agents/         # 示例/测试智能体目录（与 .u 同构）
├── .u/             # 本机默认智能体目录（可选）
├── docs/           # 本文档目录
└── scripts/        # 构建、测试、发布脚本
```

- **控制面**：`apps/gateway` 提供 WebSocket 路由、会话、cron RPC；不跑 LLM，不存人格与记忆。
- **执行端**：`apps/agent` 连接 Gateway，加载 `.u`（或指定目录），执行对话并回传；可多实例、多 agentId。
- **连接方**：Control UI（Web）、TUI（终端）、feishu-app（飞书）等通过 Gateway 与 Agent 交互。

详见 [architecture.md](./architecture.md) 与 [getting-started.md](./getting-started.md)。
