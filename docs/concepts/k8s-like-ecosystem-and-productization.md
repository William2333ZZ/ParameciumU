---
title: "K8s 化生态与产品化设计"
summary: "将 ParameciumU 做成类似 Kubernetes 的生态：声明式 API、控制平面、Operator、CLI、打包与分发；以及多维度产品化说明。"
read_when:
  - 规划平台化、生态化方向
  - 考虑商业化或开源生态
---

# ParameciumU 的 K8s 化生态与产品化

本文先做**设计**（如何把当前「单机多进程 + 一个 Gateway」做成 K8s 式生态），再从**技术产品化、生态/市场、用户体验、商业与定位**等多方面说明产品化路径。

---

## 一、设计：K8s 化生态长什么样

### 1.1 与 K8s 的类比（心法一致、领域不同）

| Kubernetes | ParameciumU（目标形态） |
|------------|-------------------------|
| **声明式 API**：Deployment、Pod、Service、CronJob | **声明式资源**：AgentDefinition、AgentInstance、NodeDefinition、NodeInstance、CronJob、ConnectorMapping、SessionPolicy |
| **控制平面**：kube-apiserver + 各类 controller 调谐「期望状态」 | **控制平面**：Paramecium API Server + Controller：根据上述资源调谐 Gateway 连接、进程/容器、cron 存储 |
| **运行时**：kubelet + 容器运行时 | **运行时**：Agent Runner（当前 apps/agent）、Node Runner（sandbox-node、browser-node 等）— 可进程、可容器、可 AI OS |
| **Operator / CRD**：扩展业务语义 | **Operator**：Agent Operator（管理 Agent 实例生命周期）、Node Operator、Cron Operator（与 agent dir 的 cron 同步） |
| **kubectl / Helm**：CLI、打包与部署 | **pctl / Charts**：声明式 apply、get/describe、Paramecium Chart（一组 Definition + Instance + Node + Cron） |
| **生态**：Helm Chart 仓库、Operator Hub | **生态**：Definition/Skill 模板市场、官方/社区 Chart、托管控制平面 |

核心一致点：**声明式「期望状态」+ 控制平面持续调谐 + 可插拔运行时与扩展**。领域不同：K8s 管的是容器与编排；ParameciumU 管的是「谁在跑哪个 Definition、连哪个 Hub、有哪些 Node、cron 如何存与执行」。

### 1.2 核心资源设计（声明式 API）

以下用「资源」表示未来可持久化、可 version、可 apply 的客体；命名仅为示意，便于和现有概念对应。

- **Gateway / Cluster**
  - 表示「一个控制平面」：当前一个 Gateway 进程 = 一个 Cluster。可扩展为：多副本 Gateway、高可用、或托管 Gateway 的「控制平面服务」。
- **AgentDefinition**
  - 对应今天的 **Definition（agent 目录）**：SOUL、IDENTITY、skills、memory、knowledge、cron 的**内容**（或引用：如 Git repo + path，或 OCI 类似物）。不包含「在哪跑、跑几份」。
- **AgentInstance**
  - 表示「在某处运行的一个 Agent」：引用一个 AgentDefinition，并带运行时约束（例如：replicas=1，nodeSelector 等价物：本机 / 某 Node 池 / 某 AI OS 设备）。Controller 的职责：确保有 N 个「连接了 Gateway 且加载了该 Definition」的 Runner。
- **NodeDefinition**
  - 描述一类 Node 的**能力与配置**（如 capabilities: [sandbox], image/script、env、resource limits）。
- **NodeInstance**
  - 表示「某处运行的一个 Node」：引用 NodeDefinition，连接同一 Gateway；Controller 确保进程/容器存在并注册到 node.list。
- **CronJob（资源）**
  - 与现有 `cron/jobs.json` 对齐：可来自 Agent 目录（当前做法），也可来自「集群级」声明，由 Controller 同步到对应 agent dir 或由 Gateway/cron 执行器消费。
- **ConnectorMapping / SessionPolicy**
  - 将「会话、渠道、推送策略」抽象为资源，便于多租户、多 Connector、策略即代码。

这样，**当前的手动「起 Gateway、起 Agent、起 Node」** 会变成：**apply 一份 YAML/JSON（或 Chart）→ 控制平面调谐 → 进程/容器被拉起、注册、按 Definition 运行**。

### 1.3 控制平面与调谐

- **API Server（可先简化为「文件 + 本地 CLI」）**
  - 存储与版本化：上述资源的 CRUD；初期可以是「指定目录下的 YAML + Git」，后期再上真正的 API 服务与 etcd 类存储。
- **Controller（调谐器）**
  - **Agent Controller**：watch AgentInstance；确保每个 Instance 有对应 Runner 进程（或 Pod/容器）；Runner 配置为连接指定 Gateway、加载对应 AgentDefinition；处理失败重启、扩缩容。
  - **Node Controller**：同理，为每个 NodeInstance 保活对应 Node 进程并注册到 Gateway。
  - **Cron Controller**：将「CronJob 资源」与 agent dir 的 `cron/jobs.json` 或 Gateway 侧 cron 存储同步，保证 deliver 等配置一致。
- **Gateway 的角色**
  - 保持现有协议与职责：路由、sessions、cron RPC、node.invoke、connector；**不**跑 LLM、不存 SOUL。在 K8s 化后，Gateway 仍是「数据面」中心；控制平面只负责「让正确的 Agent/Node 连上来」。

### 1.4 运行时形态（与现有实现兼容）

- **进程**：当前 `apps/agent`、`sandbox-node`、`browser-node` 不变，只是「由谁启动」从人变成 Controller。
- **容器**：每个 AgentInstance / NodeInstance 可对应一个容器（Docker/containerd），便于在 K8s 上跑 ParameciumU 的 Agent/Node。
- **AI OS / 边缘**：同一 AgentDefinition 可在 AI OS 设备上跑，仅 Runner 不同，协议与 Definition 一致（与 [ai-os-sketch](./ai-os-sketch.md) 一致）。

这样，**同一套 Definition 和协议**可以跑在：本机进程、你自己的 K8s、托管控制平面 + 边缘设备，形成「同一生态、多种运行时」。

### 1.5 打包与分发（Chart / 模板）

- **Paramecium Chart**
  - 类似 Helm Chart：包含默认 values 和模板，产出 AgentDefinition(s)、AgentInstance(s)、NodeInstance(s)、CronJob(s)、ConnectorMapping(s) 等。例如「一个 first_paramecium + 一个 sandbox-node + 一个 Feishu connector + 心跳 cron」打成一个 Chart，一键部署。
- **Definition / Skill 模板**
  - AgentDefinition 可引用「基础镜像」：如基于 agent-template 的变体；Skill 以目录或包的形式版本化、可复用（已有 skill-creator、agent-creator 的产出）。

### 1.6 CLI 与可观测

- **CLI（如 pctl）**
  - `pctl apply -f manifest.yaml`、`pctl get agents/nodes/cron`、`pctl describe agent <id>`、`pctl logs agent <id>` 等；背后调用控制平面 API 或直接读「声明目录 + Gateway RPC」。
- **可观测**
  - 现有 Control UI 的拓扑、sessions、cron 已是「数据面」可观测；加上「资源状态」（AgentInstance 是否 Ready、上次调谐时间）即形成「控制面 + 数据面」的完整视图。可再接 Prometheus/Grafana（Gateway 或 Runner 暴露指标）。

---

## 二、产品化：多维度说明

### 2.1 技术产品化（能交付什么）

- **稳定 API 与版本**
  - 为上述资源定义清晰 schema 与版本（如 v1alpha1），保证向后兼容或显式迁移路径；Gateway 协议已有，可再增加「控制平面 API 版本」。
- **参考实现**
  - 控制平面参考实现（如 Node 版 Controller + 文件或简单 DB 存储）、CLI（pctl）、Chart 打包与安装流程；文档与示例仓库。
- **交付物**
  - 开源：核心（Gateway、Agent、Node、协议）+ 控制平面 + CLI + 官方 Chart；可选：Docker 镜像、K8s Manifests（在 K8s 上跑 Gateway + Agent + Node）。
  - 可选商业/托管：托管控制平面 + 托管 Gateway，用户自管 Agent/Node 或使用托管 Runner。

这样，**技术产品化**的终点是：用户可以用「声明式 YAML + CLI + 可选 UI」在自建或托管环境中稳定运行多 Agent、多 Node、多 Cron、多 Connector，并具备可观测与可扩展。

### 2.2 生态与市场产品化（模版、Skill、托管）

- **Definition / Skill 市场**
  - 官方与社区「Agent 模板」「Skill 包」：可版本化、可引用、可 fork；与 skill-creator、agent-creator 产出打通，形成「创造 → 发布 → 复用」闭环。
- **Chart 仓库与场景化套件**
  - 类似 Helm 仓库：按场景（个人助手、团队协作、客服机器人、代码助手）提供 Chart，减少从零拼装成本。
- **托管与 SaaS 形态**
  - 控制平面 + Gateway 托管；用户上传或引用 Definition、配置 Connector 与 Cron；Execution 可选自管（自己的机器/ K8s）或使用平台提供的 Runner（按用量计费）。数据与「灵魂」仍可强调「你的目录、你的 Git」，仅执行层托管。

产品化重点：**降低「从零到跑通」和「从跑通到规模化」的门槛**，同时保留「Definition = 文件、可迁移」的主权。

### 2.3 用户体验产品化（一键、拓扑、可观测）

- **一键部署**
  - 通过 Chart + CLI 或 Control UI 的「从模板创建」：选模板 → 填少量参数（Gateway URL、LLM、Connector）→ apply，自动起 Gateway（或连已有）、Agent、Node、Cron。
- **拓扑与状态**
  - 现有 Control UI 的拓扑可扩展：不仅展示「谁连上了」，还展示「由哪条 AgentInstance/NodeInstance 驱动、当前状态（Ready/NotReady）、上次心跳」；资源与实时连接关系一致。
- **可观测与排错**
  - 会话、cron 执行历史、node.invoke 调用、Agent 日志聚合；与「资源」关联（例如某 CronJob 资源最近 10 次执行结果）。可选：告警（某 Agent 掉线、cron 连续失败）。

这样，**体验产品化**的终点是：从「会命令行的人才能玩」变成「选模板、填表单、看拓扑和日志就能用起来」，同时高级用户仍可用 YAML + CLI 做精细控制。

### 2.4 商业与定位产品化（为谁、解决什么问题）

- **目标用户**
  - **个人/极客**：自托管、数据主权、可编程 Agent 与 Cron；K8s 化后仍可单机一键 Chart 部署。
  - **团队/企业**：多 Agent、多 Node、统一 Gateway、权限与审计（控制平面可扩展 RBAC）；Connector 与 Session 策略即代码；可选私有化或托管。
- **与 K8s 的差异与协同**
  - **差异**：ParameciumU 不编排通用容器，而是编排「Agent 定义 + 执行 + 连接与调度」；核心是「灵魂与数据在你这、执行可分布」。
  - **协同**：可在 K8s 上跑「ParameciumU 控制平面 + Gateway + Agent/Node 作为 Pod」；也可不用 K8s，仅用本机进程或自有调度。即：**K8s 化的是「理念与形态」，不强制依赖 K8s 运行时**。
- **商业化触点**
  - 托管控制平面与 Gateway、SaaS 版 Control UI、企业 RBAC/审计、技术支持与定制；Definition/Skill 市场可抽成或增值服务。开源核心保持「可自建、可迁移」，形成「社区 + 商业」双轨。

---

## 三、实施阶段建议（如何一步步做成）

1. **Phase 0：资源形态先落地**
   - 定义 AgentDefinition / AgentInstance / NodeInstance / CronJob 的 schema（YAML/JSON），并约定「当前仅用文件或单机存储」；用现有 Gateway + Agent + Node 手动满足一份「示例 manifest」，验证语义是否覆盖现有能力。
2. **Phase 1：单机 Controller + CLI**
   - 实现单机版 Controller：读 manifest 目录，为每个 AgentInstance/NodeInstance 起子进程（当前 agent/node 可执行），保活、重启；CLI：apply/get/describe；Cron 资源与 `cron/jobs.json` 同步。不要求真实 API Server，可文件 watch。
3. **Phase 2：Chart 与模板**
   - 定义 Chart 格式与一个官方 Chart（如 first-paramecium-full）；CLI 支持 `pctl install chart-name`；Control UI 支持「从 Chart 创建」或「从模板创建」并生成 manifest。
4. **Phase 3：多机与可选 K8s**
   - Controller 支持「远程 Runner」或「在 K8s 上创建 Pod」；可选：在 K8s 上跑 Gateway + Controller，Agent/Node 作为 Workload；保持「同一协议、同一 Definition」。
5. **Phase 4：生态**
   - Definition/Skill 模板市场、Chart 仓库、文档与最佳实践；可选托管控制平面与商业化。

---

## 四、总结

| 维度 | 要点 |
|------|------|
| **设计** | 声明式资源（Agent/Node/Cron/Connector）+ 控制平面调谐 + 现有 Gateway/Agent/Node 作为数据面；CLI、Chart、可观测补齐「K8s 式」体验。 |
| **技术产品化** | 稳定 API/schema、参考实现、CLI、Chart、文档与示例；可选 K8s 部署与托管。 |
| **生态产品化** | Definition/Skill 市场、Chart 仓库、场景化套件、托管/SaaS。 |
| **体验产品化** | 一键部署、拓扑与资源状态、可观测与排错，兼顾小白与高级用户。 |
| **商业产品化** | 个人/团队/企业分层；与 K8s 协同但不绑定；商业化在托管、企业特性、市场与支持。 |

把「这套」做成 K8s 式生态，本质是：**在保留「Definition = 文件、中心路由边缘执行、数据主权」的前提下，用声明式 API 和控制平面把部署、扩缩、观测、分发标准化，让单机与多机、自建与托管都能同一套语义和体验。** 产品化则是在技术底座之上，从交付物、生态、体验、商业四个方向把「可用的系统」变成「可卖、可规模、可演进」的产品。

---

## Next steps

- [Architecture](./architecture.md)
- [Vision and roadmap](./vision-and-roadmap.md)
- [Gateway protocol](../gateway/protocol.md)
- [Apps & runtime](../runtime/apps.md)
