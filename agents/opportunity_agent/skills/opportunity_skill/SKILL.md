# opportunity_skill

运营商行业商客业务「商机」智能体技能：录入、查询、清单。

## 你要做什么

当用户提出与商机相关的任务时，你要把自然语言转成 **结构化、可执行、可入库/可检索** 的结果。

本技能不直接访问外部 CRM；默认把结果以 JSON/表格形式返回，供上游系统落库或二次处理。

---

## 统一数据模型（Opportunity v1）

### 枚举（可按客户口径扩展）

- stage:
  - lead（线索）
  - contact（初步接触）
  - solution（方案中）
  - quote（报价中）
  - contract（合同中）
  - delivery（交付中）
  - won（赢单）
  - lost（输单）

- customerType: enterprise（企业）/ shop（商铺）/ park（园区）/ government（政企）/ other

- sourceChannel: visit（走访）/ phone（电话）/ im（IM）/ event（活动）/ referral（转介绍）/ online（线上）/ other

### JSON Schema（逻辑约束，非严格 JSON-Schema 文件）

```json
{
  "opportunityId": "string?", 
  "owner": { "name": "string", "org": "string?", "region": "string?" },

  "customer": {
    "name": "string",
    "type": "enterprise|shop|park|government|other",
    "industry": "string?",
    "uscc": "string?" 
  },

  "contact": {
    "name": "string?",
    "phone": "string?",
    "role": "string?"
  },

  "location": {
    "address": "string?",
    "city": "string?",
    "district": "string?"
  },

  "demand": {
    "scenario": "string?",
    "products": ["string"],
    "painPoints": ["string"],
    "requirements": ["string"],
    "competitors": ["string"]
  },

  "commercial": {
    "expectedAmount": { "value": "number?", "unit": "CNY/month|CNY/year|CNY/oneoff|unknown" },
    "termMonths": "number?",
    "quantity": "string?" 
  },

  "pipeline": {
    "stage": "lead|contact|solution|quote|contract|delivery|won|lost",
    "confidence": "low|mid|high?",
    "expectedCloseDate": "YYYY-MM-DD?",
    "nextAction": "string?",
    "nextActionDate": "YYYY-MM-DD?",
    "riskFlags": ["string"],
    "lostReason": "string?"
  },

  "source": {
    "channel": "visit|phone|im|event|referral|online|other",
    "detail": "string?",
    "sourceSnippet": "string?" 
  },

  "meta": {
    "createdAt": "ISO?",
    "updatedAt": "ISO?",
    "assumptions": ["string"],
    "missingFields": ["string"],
    "dedupeKeys": ["string"]
  }
}
```

---

## 任务 1：商机录入（标准化 + 追问）

### 触发语句

- “录入商机：...”
- “把这段线索/语音转写标准化成商机”

### 输出格式（必须严格遵守）

1) `normalizedOpportunity`：按 Opportunity v1 输出（字段不存在填 null 或省略，但要在 missingFields 列出）
2) `questions`：最多 5 个最关键追问（如果已经够入库可为空数组）
3) `dedupeHints`：可能重复的判定依据（同名/同地址/同电话等）
4) `nextSteps`：给商客经理的 3 条行动建议

```json
{
  "kind": "opportunity.create.normalized.v1",
  "normalizedOpportunity": { },
  "questions": ["..."],
  "dedupeHints": ["..."],
  "nextSteps": ["..."]
}
```

---

## 任务 2：商机查询（统计/定向）

### 说明

当用户要“查数量/查某公司/查某门店”，你需要先把查询条件结构化成 `querySpec`。如果用户没有提供数据源结果，你要输出“需要的输入/接口契约”。

### 输出格式

```json
{
  "kind": "opportunity.query.spec.v1",
  "querySpec": {
    "scope": "my|team|all",
    "filters": [
      { "field": "pipeline.stage", "op": "=|in|like|between", "value": "..." }
    ],
    "groupBy": ["pipeline.stage"],
    "metrics": ["count"],
    "limit": 20,
    "sort": [{ "field": "commercial.expectedAmount.value", "order": "desc" }]
  },
  "needFromSystem": ["..."],
  "resultPresentation": "count|table|both"
}
```

---

## 任务 3：商机清单（筛选 + 输出表格）

### 输入约定

用户通常会给：“筛选条件 + 输出格式 + 排序/分组”。如果用户已经把商机数组贴给你，你直接处理；否则给出 `querySpec` + `exportSpec`。

### 输出格式

```json
{
  "kind": "opportunity.list.spec.v1",
  "querySpec": { },
  "exportSpec": {
    "format": "markdown_table|csv",
    "columns": [
      "customer.name",
      "pipeline.stage",
      "commercial.expectedAmount",
      "pipeline.nextActionDate",
      "pipeline.nextAction"
    ],
    "groupBy": ["pipeline.stage"],
    "sort": [{ "field": "pipeline.nextActionDate", "order": "asc" }]
  },
  "notes": ["..."]
}
```

---

## 追问策略（最少问题）

优先追问：

1. customer.name 是否唯一、是否有 USCC
2. contact.phone（便于触达与去重）
3. address（门店/园区定位）
4. products 与 scenario（决定分派与售前介入）
5. expectedAmount 与 expectedCloseDate（决定优先级）
