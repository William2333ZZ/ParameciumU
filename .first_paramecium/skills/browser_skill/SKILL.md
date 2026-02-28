---
name: browser_skill
description: Discover Browser Node(s), open URLs (browser_fetch), get links (browser_links), click elements (browser_click), fill inputs (browser_fill). Screenshots render as images in chat.
---

# Browser Skill

**发现 + 执行**：列出具备 browser 能力的节点与命令；打开 URL、取正文与截图；**当前页取链接、点击、填表**，支持多步交互与登录态保留（需配置 BROWSER_USER_DATA_DIR）。

## Tools

| Tool | Use |
|------|-----|
| **browser_nodes** | 列出具备 browser 能力的节点及 supportedCommands（nodeId、支持的命令名）。无结果表示没有 Browser Node 连接。 |
| **browser_capabilities** | 返回节点支持的命令 schema（名称、描述、参数）。 |
| **browser_fetch** | 用 Browser 节点打开 URL，返回页面正文；默认附带**页面截图**。参数：url（必填）、nodeId、timeoutMs、captureScreenshot（默认 true）、waitAfterLoadMs（如登录页扫码可传 60000）。 |
| **browser_links** | 获取**当前页面**所有链接（文本 + URL），便于找到「我的主页」等再打开或点击。 |
| **browser_click** | 在**当前页面**点击元素：按文本（如「我的主页」）或按 CSS 选择器。 |
| **browser_fill** | 在**当前页面**输入框/文本框填入内容（先清空再填）。按 selector 或 placeholder 定位。参数：text（必填）、selector 或 placeholder。 |

## When to use

- **「有没有浏览器节点？」/「能做什么？」** → `browser_nodes` / `browser_capabilities`
- **「打开某网页、把页面内容/截图给我」** → `browser_fetch`
- **「当前页有哪些链接？找我的主页」** → 先 `browser_links`，再 `browser_fetch(该 URL)` 或 `browser_click("我的主页")`
- **「在搜索框输入、登录框填账号密码」** → `browser_fill`（placeholder 或 selector）

## Guidelines

- 需要连接 Gateway；无 Browser Node 时先启动 browser-node 并设 `BROWSER_USER_DATA_DIR` 以保留登录态。
- 浏览器常驻、不每次关闭；多步操作为：fetch 打开页 → links/click/fill 交互 → 再 fetch 或截图查看结果。
- 图像：Control UI 在 tool 结果中渲染 Markdown 图片（含 data URL 或 /api/screenshots URL），即图像模态。
