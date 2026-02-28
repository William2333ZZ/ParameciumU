---
title: "ParameciumU 产品叙事与命名愿景"
summary: "从草履虫进化论出发：第一只草履虫、吸收营养进化、复制繁殖的产品隐喻与未来形态"
read_when:
  - 理解产品命名与世界观时
  - 规划「自进化、多智能体」能力时
---

# ParameciumU：你是一只草履虫

## 〇、从草履虫开始：吸收与进化

ParameciumU 的故事从**第一只草履虫**开始：单细胞、可吸收、可进化、可繁殖。在实现上，我们**吸收**开源生态中的思路与能力，在独立栈上持续演化：

- **OpenClaw**：Gateway 控制面、多会话、Cron RPC、Connector 等能力域作为规划参考；ParameciumU 不依赖其代码与协议，但在「连接层、控制面、执行端、定义层」上覆盖并超越同类能力。
- **OpenCode / 开源代码能力**：技能化、工具化、定义即文件的思路；agent 通过 skill-creator、knowledge、memory 等「吸收」知识并固化为能力。
- **pi-mono 等**：终端 TUI、多端接入、轻量部署等形态的参考；ParameciumU 的 TUI、Control UI、飞书 Connector 等为产品自身设计，不绑定单一上游。

**.first_paramecium** 即「第一只草履虫」：你工作区里的默认智能体目录，与 `packages/agent-template/template` 同构。其 **skills** 与模板对齐（通过 `ensureAgentDir()` 从 `@monou/agent-template` 补齐），包含 base_skill、skill-creator、agent-creator、memory、knowledge、cron、web_skill 等；从这一只出发，可吸收营养进化、可克隆繁殖出更多 agent。

---

## 一、隐喻是否成立

从达尔文进化论 / 生物学角度：

- **草履虫（Paramecium）**：单细胞生物，能通过胞口吸收外界营养（有机物、细菌），在体内消化、同化，从而获得能量与构建自身；能无性繁殖（分裂成两个新个体）。
- **对应到智能体**：
  - **吸收营养** = 吸收知识（knowledge）、技能（skills）、记忆（memory）——你喂给它的文档、对话、工具，它「吃进去」后变成能力。
  - **进化** = 技能越来越多、知识库越来越丰富、行为越来越贴合你的需求；从「只会基础读写」到「会写代码、会查资料、会定时汇报」。
  - **复制繁殖** = 从同一套定义克隆出新智能体（新目录、新 agentId），或从「第一只」分裂出专门做某事的子代（子 agent、专项 paramecium）。

所以：**「You are a Paramecium」+ 「草履虫吸收营养、进化、繁殖」** 的隐喻是自洽的。产品名 **ParameciumU** = Paramecium + U（你）→ 你的那只草履虫，或「你作为一只草履虫」——从单细胞起点，持续进化、自生长的「另一个你」。

---

## 二、命名与文件夹的约定

| 概念 | 命名 | 含义 |
|------|------|------|
| 产品 / 项目 | **ParameciumU** | 以草履虫为隐喻的主权智能体平台 |
| 默认智能体目录 | **`.first_paramecium`** | 第一只草履虫：你工作区里的「本尊」智能体，与 .u 同构，可吸收、可进化、可被克隆 |
| 同构目录 | 任意同名结构目录 | 如 `agents/code_engineer`、`agents/xxx`：都是「同一物种」的不同个体，可由 .first_paramecium 克隆或独立演化 |
| 未来扩展 | 可选 `.paramecia/` 等 | 多只草履虫的集合目录（可选命名，不做强制） |

- **为什么是 .first_paramecium**：强调「第一只」——从它开始，你可以复制出更多只（不同 agentId、不同目录），或让它不断吸收营养进化。名字即叙事。
- **与 .u 的关系**：.u 曾是「另一个你」的缩写；改为 .first_paramecium 后，语义从「你」变成「你的第一只草履虫」，更贴合「可进化、可繁殖」的设定。

---

## 三、未来的样子（愿景）

1. **第一只草履虫**  
   用户在工作区拥有 `.first_paramecium`：一只默认的、可配置的智能体，通过 SOUL/IDENTITY/skills/knowledge/memory 不断「吸收营养」并进化。

2. **吸收与进化**  
   - 知识库、记忆、技能 = 营养来源；对话与工具调用 = 消化与同化。  
   - 产品能力：skill-creator、knowledge_learn、memory 等已支持「吸收」；Heartbeat/Cron 支持周期性的「代谢」与汇报。

3. **繁殖与分化**  
   - 从 .first_paramecium 克隆出新目录（新 agentId），或通过 skill/agent-creator 在运行时「分裂」出子智能体。  
   - 未来可显式支持：`paramecium clone`、多目录管理（如 `.paramecia/frontend-cell`、`.paramecia/backend-cell`）等，让「多只草履虫」各司其职。

4. **名字的统一**  
   - 对外：**ParameciumU**（产品名、文档、站点）。  
   - 对内：默认目录 **.first_paramecium**，协议与实现继续为产品服务，不依赖、不对齐其他品牌；能力上覆盖并超越同类。

---

## 四、小结

- **逻辑**：草履虫吸收营养 → 进化；草履虫分裂 → 繁殖。智能体吸收知识/技能 → 能力增强；智能体克隆/创建子 agent → 多智能体。隐喻成立。
- **命名**：ParameciumU = 产品；.first_paramecium = 第一只草履虫（默认智能体目录）。
- **未来**：从「第一只」出发，吸收、进化、繁殖，形成你个人的 Paramecium 生态。

## 下一步

- 产品定位与能力规划：[vision-and-roadmap](./vision-and-roadmap.md)
- 整体架构与 L4 定义层：[architecture](./architecture.md)
- Agent 目录约定（.first_paramecium 同构）：[agent-directory](./agent-directory.md)
