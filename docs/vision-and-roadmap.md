# monoU 产品定位与能力规划

本文档明确 monoU 的定位、与 OpenClaw 的关系、设计原则以及能力规划路线图。**monoU 不依赖 OpenClaw，也不以「与 OpenClaw 协议子集对齐」为目标**；monoU 是独立栈，在架构与能力上规划为超越 OpenClaw。

---

## 一、定位与关系

### 1.1 产品定位

- **monoU**：以「智能体标准化定义（基于文件夹）」为核心的主权智能体产品。同一套定义跨平台运行，控制面与执行端分离，数据与人格在用户侧。
- **协议与实现**：拥有自己的 Gateway 协议与实现（`packages/gateway` + `apps/gateway`），不承诺与任何外部协议兼容；演进以 monoU 自身需求为准。
- **目标**：在架构清晰度、可扩展性、数据主权、多端接入与自动化能力上，做到**超越**同类方案（包括 OpenClaw），而非跟随或子集。

### 1.2 与 OpenClaw 的关系

| 维度 | 说明 |
|------|------|
| **依赖** | 不依赖 OpenClaw 代码或运行时。仓库内若存在 openclaw 目录，仅作参考或历史对比，非构建/运行依赖。 |
| **协议** | 不以「OpenClaw 协议子集」为设计目标。当前实现中与 OpenClaw 相似的部分（如 connect、cron.*、connector.message）是独立设计的结果，可随时按 monoU 需求调整或扩展。 |
| **能力对照** | 将 OpenClaw 的能力域作为**规划参考**：用于查漏补缺、确保 monoU 在「连接层、调度、多端、多 Agent」等维度上覆盖相当或更强的能力，而不是为了兼容其协议。 |

结论：**monoU 覆盖并超越 OpenClaw 所代表的能力，但不对齐其协议、不依赖其实现。**

---

## 二、设计原则（巩固）

在 [architecture.md](./architecture.md) 基础上，强调以下原则以支撑「独立且超越」的定位：

| 原则 | 含义 |
|------|------|
| **定义即文件** | 智能体 = 符合约定的文件夹（SOUL、IDENTITY、skills、cron 等）；可版本化、可迁移、不锁云与运行时。 |
| **编排在中心、执行在边缘** | 控制面（Gateway）只做路由、映射、推送；会话、记忆、技能、定时在 Agent 端或独立 daemon 执行。 |
| **数据与人格在用户侧** | 身份、灵魂、记忆、技能在用户可控目录；产品不占有、不锁定。 |
| **一层一事** | 每层职责单一，可替换、可扩展。 |
| **自进化在产品内** | 新 Agent、新 Skill 由运行中的 Agent 在自有目录内创建（如 agent-creator、skill-creator），不依赖平台发版。 |
| **协议为产品服务** | Gateway 协议为 monoU 产品需求服务，优先简洁、可演进；不背负历史或第三方兼容包袱。 |
| **Connector 与 Channel 统一抽象** | 所有接入（Web、飞书、企微、API 等）统一为 Connector；推送、入站、会话映射用同一套模型，便于扩展新渠道。 |

---

## 三、能力域规划（对照参考，非兼容清单）

以下将「OpenClaw 所代表的能力」作为规划参考，列出 monoU 的现状与规划方向。**目的**：确保 monoU 在功能上覆盖相当或更强，**不是**实现 OpenClaw 协议。

### 3.1 连接层（L1）

| 能力 | OpenClaw 参考 | monoU 现状 | 规划 |
|------|----------------|------------|------|
| Web 控制台 | Control UI | ✅ control-ui | 持续迭代体验与拓扑展示 |
| 飞书 | Feishu 插件，网关内 channel | ✅ feishu-app（独立进程，Connector） | 保持独立进程模型；可选增加多实例、多租户配置 |
| 终端 TUI | - | ✅ u-tui | 与 Gateway 对话 + Cron 面板 |
| 企微 / 钉钉 / API | 部分或社区 | 未实现 | 按需新增 Connector（同 feishu-app 模式：独立进程 + connectorId + mapping） |

**设计要点**：所有 L1 均以 **Connector** 身份连接 Gateway；入站走 `connector.message.inbound`，推送走 `connector.message.push`；映射用 `connector.mapping.*`。不引入「channel 插件内嵌网关」的形态，保持 Gateway 薄、Connector 可独立扩展。

### 3.2 控制面（L2）

| 能力 | OpenClaw 参考 | monoU 现状 | 规划 |
|------|----------------|------------|------|
| 路由与会话 | 会话、多 agent、last channel | ✅ sessions.*、connector.mapping | 会话过期策略、多 sessionKey 策略已具备；按需增加会话标签、归档 |
| 认证与安全 | token / password | ✅ GATEWAY_TOKEN / PASSWORD、TLS | 可选：方法级权限、限流、审计 |
| Cron RPC | cron list/add/update/remove/run | ✅ cron.*，存储可指向 .u 或 agent 目录 | 保持「存储与执行分离」；执行在 Agent 端或独立 daemon |
| 主动推送 | 渠道插件投递 | ✅ connector.message.push | 已统一：由 Gateway 推给对应 Connector，由 Connector 发往具体渠道 |
| 多 Agent / 多 Node | agent 列表、node.invoke | ✅ agents.list、node.list、node.invoke | 保持；可选：Agent 组、负载策略 |

**设计要点**：Gateway 不跑 LLM、不跑 Cron 执行、不存人格与记忆；只做路由、映射、RPC、推送与转发。

### 3.3 执行端（L3）

| 能力 | OpenClaw 参考 | monoU 现状 | 规划 |
|------|----------------|------------|------|
| Agent 进程 | 内嵌或独立 | ✅ apps/agent 独立进程，连 Gateway | 保持独立进程；可选：远程 Agent、多机部署 |
| 定时执行 | 网关内 cron 或心跳 | ✅ Agent 进程内 runScheduler + onJobDue；可选 cron:daemon | 执行与存储解耦；deliver 推送到 Connector（如飞书） |
| 隔离任务 vs 主会话 | 隔离 session / 主会话 systemEvent | ✅ payload.kind: agentTurn / systemEvent；deliver 可选 | 保持；文档明确 deliver 的 connectorId/chatId 用法 |
| 心跳 | 定时唤醒主会话 | ✅ Heartbeat 任务（可配置禁用） | 保持可配置；不与 OpenClaw 心跳协议对齐 |
| Node（工具执行端） | node.invoke 目标 | ✅ sandbox-node、node.invoke 转发 | 扩展更多 Node 类型（如本地脚本、远程 API） |

**设计要点**：Cron 的「存储」在 monoU 侧（.u/cron 或 agents/xxx/cron）；「执行」在 Agent 进程或独立 daemon；「汇报」通过 deliver + connector.message.push，不引入 OpenClaw 的 delivery.channel 枚举，统一用 connectorId + chatId。

### 3.4 定义层（L4）

| 能力 | OpenClaw 参考 | monoU 现状 | 规划 |
|------|----------------|------------|------|
| 灵魂 / 身份 | - | ✅ SOUL.md、IDENTITY.md | 保持；可选：多身份、角色切换 |
| 技能 | 工具与 prompt 片段 | ✅ skills/<name>/SKILL.md、scripts | 保持；自进化（skill-creator） |
| 记忆 / 知识库 | - | ✅ memory/、KNOWLEDGE.md、knowledge/ | 按需扩展检索与持久化 |
| 定时任务定义 | cron jobs.json | ✅ cron/jobs.json、@monou/cron 类型 | 保持；deliver 已在类型与 Gateway 侧支持 |

**设计要点**：L4 完全由 monoU 约定定义，无第三方格式依赖；任何兼容「目录约定」的运行时均可复现同一智能体。

---

## 四、协议与实现边界

- **协议定义**：`packages/gateway` 中的方法名、params、payload 形状由 monoU 产品需求决定；新增或变更时以「简洁、可演进、易实现多端」为准。
- **服务端实现**：`apps/gateway` 是当前唯一官方服务端；可存在其他实现（如轻量代理、测试桩），但不必与 OpenClaw 服务端兼容。
- **客户端**：Control UI、TUI、feishu-app、apps/agent 等均依赖 `@monou/gateway` 的协议类型与调用方式；不依赖 OpenClaw 客户端或 SDK。

---

## 五、路线图（建议优先级）

1. **文档与约定固化**  
   - 在 README、architecture、gateway、apps 中明确「不依赖 OpenClaw、协议独立」的表述。  
   - 将「能力对照」从「兼容清单」改为「规划参考」（本文档第三节）。

2. **Cron 汇报体验闭环**  
   - 在 agent-directory 或 cron 技能说明中补充：如何为任务配置 `deliver: { connectorId, chatId }`，以及如何获取飞书 chatId。  
   - 可选：Control UI 或 TUI 中支持为 Cron 任务选择「汇报到」的 Connector + 会话。

3. **Connector 扩展路径**  
   - 保留 feishu-app 作为参考实现；新 Connector（企微、钉钉、HTTP API）按同一模式：独立进程、长连 Gateway、inbound/push、mapping。  
   - 文档中提供「新增 Connector 清单」（环境变量、启动顺序、映射配置）。

4. **可选增强（按需）**  
   - 多 Agent 组与路由策略。  
   - 方法级鉴权与审计。  
   - 会话标签、归档、导出。  
   - 远程 Agent / 多机部署。

---

## 六、总结

- **monoU 覆盖并超越 OpenClaw 所代表的能力，但不依赖 OpenClaw，也不与其协议子集对齐。**
- **能力规划**：以「连接层、控制面、执行端、定义层」为维度，用 OpenClaw 作对照参考查漏补缺，确保 monoU 在各自维度上达到或超过同类能力。
- **协议与实现**：完全为 monoU 产品服务，独立演进；文档与代码中避免「兼容 OpenClaw」的承诺或表述，改为「能力覆盖与超越」的规划描述。

本文档与 [architecture.md](./architecture.md)、[gateway.md](./gateway.md)、[apps.md](./apps.md) 一起，构成 monoU 的定位与设计基线；后续新增能力或重构时，以本文档原则与能力域为据进行规划设计。
