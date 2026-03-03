# Solution Agent（需求解决方法智能体）

面向客户需求文档与文字输入，基于大模型自动解读需求并按标准六章模板生成完整解决方案，支持多轮迭代与 Word 导出。

## 核心功能清单

| 编号 | 功能名称 | 功能描述 | 优先级 |
|------|----------|----------|--------|
| FR-001 | 客户需求文档上传 | 支持上传 Word(.doc/.docx) 和 Excel(.xls/.xlsx)，自动提取文本内容 | P0 |
| FR-002 | 需求文字输入 | 支持在对话框直接输入客户需求描述文字 | P0 |
| FR-003 | AI 需求解读 | 基于大模型自动理解文档，提炼业务背景、痛点、目标、功能需求等核心信息 | P0 |
| FR-004 | 解决方案生成 | 按标准模板自动生成完整解决方案内容（含全部 6 大章节） | P0 |
| FR-005 | Word 文档导出 | 将方案渲染为规范 Word 文档，支持一键下载 | P0 |
| FR-006 | 多轮对话迭代 | 支持追加修改意见，基于对话历史迭代更新方案 | P1 |
| FR-007 | 会话管理 | 支持创建新会话、查看历史会话记录（按客户区分） | P1 |
| FR-008 | 流式输出 | 方案内容以流式方式逐步展示，提升等待体验 | P2 |

## 输出文档结构要求

必须严格按以下目录结构生成解决方案文档（详见 `skills/solution_skill/references/document-structure.md`）：

1. **项目背景**
2. **需求分析**
   - 2.1 现状和问题分析（2.1.1 现状 / 2.1.2 问题分析）
   - 2.2 需求分析
3. **总体设计方案**
   - 3.1 建设思路
   - 3.2 总体架构
   - 3.3 业务流程说明
   - 3.4 建设内容
4. **项目交付计划**
   - 4.1 交付整体规划
   - 4.2 交付保障措施
   - 4.3 交付后规划
   - 4.4 售后运维保障
5. **项目建设清单**
6. **建设成效**

## 输出规范

- **格式**：标准 .docx（含封面、目录、规范排版）
- **命名**：`解决方案_客户名称_日期.docx`
- **触发**：内容生成完成后自动显示下载按钮
- **操作流程**：新建会话 → 上传/输入需求 → **AI 立即生成方案正文** → 迭代调整 → 用户说「输出word文档」时**调用 generate_word_document 工具** → 下载 Word

## 架构要求（三层）

1. **交互层**：Web 对话界面（支持文档上传 / 文本输入 / 下载）
2. **AI 推理层**：大模型驱动（需求解析 + 方案生成）— 本 Agent
3. **文档生成层**：模板渲染为规范 Word 文档

## 工具与技能

- **base_skill**：read、bash、edit、write（文件与探索）
- **solution_skill**：需求解读、方案生成、六章模板约束与引用
- **doc_export_skill**：用户说「输出word文档」时调用 **generate_word_document**（content、clientName、date、outputDir）生成规范 .docx 并返回路径

## 运行

连接 Gateway 时指定本目录与 ID：在 Control UI 或 RPC 中选择 `agentId: solution_agent` 即可把对话派发到本 Agent。

**Word 导出**：使用「输出word文档」前，**必须**在本目录下执行一次依赖安装，否则会报 `Cannot find package 'docx'`：

```bash
cd agents/solution_agent && npm install
```

或从仓库根执行：`npm install --prefix agents/solution_agent`。依赖仅装在本目录，不污染仓库根、也不修改 apps/。

## 说明

- SOUL.md、IDENTITY.md 定义原则与身份；文档结构以 `skills/solution_skill/references/document-structure.md` 为准。
- 架构与前后端分工见 `skills/solution_skill/references/architecture.md`。
