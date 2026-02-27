# monoU 文档

**项目代号：ParameciumU** — 从单细胞起点持续进化、自生长的「另一个你」智能体平台。

monoU 以「智能体标准化定义（基于文件夹）」为核心：同一套定义跨平台运行，控制面与执行端分离，数据与人格在用户侧。

## 文档结构

| 目录 | 说明 |
|------|------|
| [guide/](./guide/) | 入门：快速开始 |
| [architecture/](./architecture/) | 架构与概念：产品定位、整体架构、Agent 目录约定 |
| [runtime/](./runtime/) | 运行与协议：Gateway、apps、packages、Agent 运行机制、Heartbeat |
| [control-ui/](./control-ui/) | Control UI：界面设计、节点能力接入 |
| [reference/](./reference/) | 参考：code_skill 设计、Browser Node 设计 |
| [deploy-docs-site.md](./deploy-docs-site.md) | 维护：如何将文档部署成网页 |

## 项目结构速览

```
monoU/
├── apps/       # gateway、agent、control-ui、TUI、feishu-app、sandbox-node
├── packages/   # 公共库（agent-core、gateway、agent-from-dir 等）
├── agents/     # 示例智能体目录（与 .u 同构）
├── .u/         # 本机默认智能体目录（可选）
└── docs/       # 本文档
```

- **控制面**：`apps/gateway` 提供 WebSocket 路由、会话、cron RPC。
- **执行端**：`apps/agent` 连接 Gateway，加载 `.u` 或指定目录执行对话。
- **连接方**：Control UI、TUI、飞书等通过 Gateway 与 Agent 交互。

## 快速链接

- [快速开始](./guide/getting-started.md) — 构建、启动 Gateway / Agent / Control UI
- [整体架构](./architecture/architecture.md) — 四层抽象与代码划分
- [Gateway 协议](./runtime/gateway.md) — 连接、会话与 RPC
