---
title: "Browser Node 设计"
summary: "WebKit 小内核作为 Node 类型、node.invoke 与 browser 能力、有头/无头与 Control UI"
read_when:
  - 接入或扩展浏览器节点时
  - 理解 node.invoke 与 capabilities 时
---

# Browser Node 设计（WebKit 小内核作为 Node 类型）

## 一、目标

把「用 WebKit 执行 JS 后抓取页面」做成一种 **Node 类型**，与现有 sandbox-node 并列：

- **Agent 进程保持轻量**：不内嵌 Playwright/WebKit，只通过 Gateway 调 node.invoke。
- **Browser 能力独立部署**：单独进程以 role=node 连接，声明 capabilities: ["browser"]。
- **多 Agent 共享**：多个 Agent 可共用同一台 Browser Node。
- **与现有协议一致**：沿用 node.invoke / node.invoke.request / node.invoke.result，payload 约定与 sandbox-node 风格统一。

**扩展方向**：

- **有头 / 无头**：Playwright 支持 `headless: false`，可配置为有头模式，用户能看到浏览器窗口，便于调试或「人看 Agent 操作」的辅助浏览。
- **自动化操作**：Node 不仅做一次性 `browser_fetch`，还可暴露「会话 + 操作」：打开页面 → 点击、填表、输入 → 截取快照/正文，供 Agent 做多步自动化（填单、登录、爬取需交互的页面等）。

---

## 二、身份与连接

| 项目 | 约定 |
|------|------|
| **role** | `"node"` |
| **deviceId** | 环境变量 `BROWSER_NODE_ID`，默认 `browser-1`（用于 node.list / node.invoke 目标） |
| **capabilities** | `["browser"]`，便于 Gateway/UI 区分「沙箱 Node」与「浏览器 Node」 |
| **连接** | 与 sandbox-node 相同：WebSocket 连 Gateway，首条 `connect` 带 token/password（若启用认证） |

调用方通过 `node.list` 看到节点，用 `nodeId`（或 deviceId）作为 `node.invoke` 的 `params.nodeId` 定向调用。

---

## 三、node.invoke 协议（Browser Node 侧）

调用方发起：

```ts
// RPC: node.invoke
{ method: "node.invoke", params: { nodeId: "browser-1", command: "browser_fetch", params: { url: "https://..." } } }
```

Gateway 将 `{ id, nodeId, command, params, timeoutMs? }` 原样作为 `node.invoke.request` 的 payload 发给 Browser Node。

### 3.1 支持的 command

**一次性拉取（无状态）**

| command | 说明 | params |
|---------|------|--------|
| **browser_fetch** | 用 WebKit 打开 URL，执行 JS 后取页面正文文本 | `url: string`（必填）, `timeoutMs?: number`（可选，默认 15000） |

**会话 + 自动化（有状态）**

一次「会话」内可连续发多条 command，在同一页面上做多步操作（导航、点击、填表、取快照），适合 Agent 做「打开 → 点哪 → 填什么 → 再取内容」的流程。

| command | 说明 | params |
|---------|------|--------|
| **browser_session_start** | 创建会话（新 page），返回 sessionId | `timeoutMs?`（本会话默认超时） |
| **browser_navigate** | 在会话内打开 URL | `sessionId`, `url`, `timeoutMs?` |
| **browser_click** | 点击元素 | `sessionId`, `selector`（CSS 或 text=…）, `timeoutMs?` |
| **browser_fill** | 清空后填入文本（input/textarea） | `sessionId`, `selector`, `value` |
| **browser_type** | 逐字输入（模拟键盘） | `sessionId`, `selector`, `text`, `delayMs?` |
| **browser_snapshot** | 取当前页可读快照（可访问性树或简化 DOM），供 LLM 决定下一步 | `sessionId`；可选 `role?`（如 button、link）过滤 |
| **browser_content** | 取当前页正文文本（同 browser_fetch 的 content） | `sessionId`, `maxLength?` |
| **browser_screenshot** | 可选：截图，返回 base64 或路径 | `sessionId` |
| **browser_session_end** | 关闭会话，释放 page | `sessionId` |

- `sessionId` 由 `browser_session_start` 的 `payload.sessionId` 返回，后续 command 必带。
- 会话超时或进程重启后 sessionId 失效；未调用 `browser_session_end` 的可做超时自动回收。

### 3.2 返回格式（node.invoke.result）

与 sandbox-node 对齐，统一用 `result: { ok, payload?, error? }`：

- **成功**：`result: { ok: true, payload: { content: string } }`  
  - `content` 为执行 JS 后的 `document.body.innerText`（或等价），截断策略与现有 web_fetch 一致（如 80_000 字符 + "[truncated]"）。
- **失败**：`result: { ok: false, error: { code: string, message: string } }`  
  - 例如超时、导航错误、无效 URL。

这样 Agent 端 **browser_skill** 拿到 `result.payload.content` 即可直接当 tool 的 content 返回给 LLM。

---

## 四、Browser Node 实现要点

- **新建 app**：`apps/browser-node`（与 `apps/sandbox-node` 同级）。
- **依赖**：仅依赖 `playwright`，且只安装/使用 WebKit：  
  - 安装：`npx playwright install webkit`（不装 chromium/firefox）。  
  - 运行时：`import { webkit } from "playwright"`。

### 4.1 有头 / 无头

- **无头（默认）**：`webkit.launch({ headless: true })`，适合无界面服务器、仅抓取/自动化。
- **有头**：环境变量 `BROWSER_HEADED=1` 时使用 `headless: false`，会弹出真实浏览器窗口。  
  - 用途：调试、或「人看着 Agent 操作」的辅助浏览（用户可见点击/填表过程）；也可在本机先手动登录知乎/小红书，再让 Agent 用同一浏览器发帖。  
  - **窗口出现在哪**：在**运行 Browser Node 进程的那台机器**的显示器上。因此若希望自己看到窗口并手动登录，应在本机（有桌面的电脑）启动 browser-node；若在无显示服务器上跑，有头要么不可用（无 DISPLAY），要么需 Xvfb + VNC/远程桌面才能看到。
  - 同一 Node 进程内通常统一有头或无头；若需并存可后续做「按 session 指定 headed」等扩展。

### 4.1.1 检测到登录页时再启动有头（推荐）

- **需求**：平时无头跑（省资源、可放 Docker），只有「需要人工登录」时再弹出有头窗口，让用户完成登录/验证码。
- **做法**：  
  1. 默认无头；会话内 `browser_snapshot` / `browser_navigate` 后可根据 URL 或快照内容**检测登录页**（如 URL 含 `login`/`signin`、或快照含「登录」「验证码」等关键词）。  
  2. 检测到后，Node 临时**再起一个 headed 浏览器**，使用**同一 BROWSER_USER_DATA_DIR**，打开当前页或登录页；用户在本机完成登录后关闭该窗口（或通过 command 通知「已登录」）。  
  3. 有头浏览器退出时，cookie 已写入 userDataDir；原无头会话继续用同一 userDataDir，刷新或重新 navigate 即可带上登录态，无需改现有 session。  
- **实现要点**：Node 内维护「无头 browser」单例；检测到需登录时 `webkit.launch({ headless: false, userDataDir })` 起第二个实例，navigate 到登录 URL，用户操作完后 close；无头侧可返回 `payload: { needsLogin: true, loginUrl?, message: "已启动有头窗口，请在本机完成登录后关闭窗口或回复已登录" }`，便于 Agent 提示用户。
- **可选 command**：`browser_request_login(sessionId?, url?)`：显式请求「打开有头窗口让用户登录」，不依赖自动检测；或由 Agent 在发现 401/登录跳转时调用。

### 4.2 生命周期（一次性 vs 会话）

- **browser_fetch**：无状态。每次临时 launch page（或复用 browser 单例）→ goto → 取正文 → 关 page，不保留会话。
- **自动化**：维护 `sessionId → Page` 映射。`browser_session_start` 创建 page 并生成 sessionId；后续 command 根据 sessionId 找到 page 执行；`browser_session_end` 或超时后移除映射并关闭 page。
- **Browser 实例**：进程内可共用一个 `browser = await webkit.launch(...)`，多会话 = 多个 page（或 context + page），按需创建。

### 4.3 超时与安全

- 每个 command 支持 payload 的 `timeoutMs`；会话可设默认超时，超时未活动则回收 session。
- 仅允许 http/https URL；可配置域名白名单（可选）。

### 4.4 持久化 profile（登录一次、长期有效）

- Playwright 支持 **userDataDir**：将浏览器数据（cookie、localStorage、登录态）写入指定目录，下次用同一目录启动会沿用。
- 环境变量 **BROWSER_USER_DATA_DIR**：若设置，则 `webkit.launch({ userDataDir: process.env.BROWSER_USER_DATA_DIR })`，这样：
  - 有头时在本机登录知乎/小红书一次，关闭或重启 Browser Node 后，再启动仍为已登录状态；
  - 无头时若需带登录态抓取，可先在有头环境下登录并写入该目录，再在无头环境下使用同一目录。
- 建议路径为本机可写目录，如 `./.browser-profile` 或 `~/.monou-browser-profile`。

---

## 五、Agent 侧：browser_skill 如何用 Browser Node

### 5.1 browser_skill（独立技能）

- **browser_nodes**：列出具备 browser 能力的节点（调用 node.list 并过滤 capabilities 含 "browser"），供 Agent 发现是否有 Browser Node 在线。
- **browser_fetch_js**：拉取需要执行 JavaScript 才能得到正文的页面；需有 Browser Node 连接 Gateway。参数 `url`（必填）。实现：若未配置 `BROWSER_NODE_ID` 则通过 node.list 发现 browser 节点，再 `gatewayInvoke("node.invoke", { nodeId, command: "browser_fetch", params: { url } })`，从 `result.payload.content` 取正文。

LLM 在「已知是 SPA/强 JS 渲染」时选 **browser_fetch_js**，否则用 web_skill 的 **web_fetch**（纯 fetch）。

### 5.2 Agent 侧：自动化操作（会话类工具）

若希望 Agent 能「操作浏览器」（打开页 → 点、填、再取快照），可在 browser_skill 中暴露一组工具，内部统一走 node.invoke(BROWSER_NODE_ID, command, params)：

- **browser_session_start** → 返回 sessionId；sessionId 需在当轮或本会话内保留（例如由 executeTool 返回给 LLM，后续工具由 LLM 传入 sessionId；或由 Agent 状态/会话 metadata 保存）。
- **browser_navigate** / **browser_click** / **browser_fill** / **browser_type** / **browser_snapshot** / **browser_content** / **browser_session_end**：参数与 Node 的 command params 一致，工具内只做 gatewayInvoke("node.invoke", { nodeId, command, params }) 并格式化 result。

有头模式下，用户可同时打开该 Browser Node 的窗口，看到 Agent 的点击、填表过程，实现「人看 + Agent 操作」的辅助浏览或自动化。

### 5.3 可选：web_fetch 自动降级

在现有 `web_fetch` 中，先按当前逻辑 fetch；若返回的 HTML 疑似 SPA 壳（例如 body 文本极短、或只有 root 空 div），再尝试用 Browser Node 的 `browser_fetch` 拉一次，并返回该结果。  
实现复杂且易误判，建议首期只做 5.1，不做自动降级。

---

## 六、环境变量汇总

| 变量 | 作用域 | 说明 |
|------|--------|------|
| **GATEWAY_URL** | browser-node | 必填，Gateway WebSocket 地址 |
| **BROWSER_NODE_ID** | browser-node | 本节点 ID，默认 `browser-1` |
| **BROWSER_HEADED** | browser-node | 设为 `1` 时有头模式（可见窗口），默认无头；窗口出现在运行 browser-node 的那台机器的显示器上 |
| **BROWSER_USER_DATA_DIR** | browser-node | 可选，浏览器 profile 持久化目录（cookie/登录态保留），如 `./.browser-profile` |
| **GATEWAY_TOKEN / GATEWAY_PASSWORD** | browser-node | 可选，与 Gateway 认证一致 |
| **BROWSER_NODE_ID** | agent（或运行 agent 的环境） | 可选，browser_fetch_js / 浏览器工具调 node.invoke 时使用的 nodeId；不设则从 node.list 发现 |

---

## 七、与 sandbox-node 的对比

| 项目 | sandbox-node | browser-node |
|------|--------------|--------------|
| capabilities | `["sandbox"]` | `["browser"]` |
| command | system.run, system.which | browser_fetch；会话类：browser_session_* / navigate / click / fill / snapshot / content / session_end |
| 典型用途 | 隔离执行命令 | 执行 JS 抓取、有头时可看、多步自动化操作 |
| 依赖 | Docker（可选）/ 子进程 | Playwright WebKit；可开有头（BROWSER_HEADED=1） |

Gateway 无需区分 Node 类型，只要按 nodeId 转发；能力由各 Node 根据 command 自行实现。

---

## 八、实现顺序建议

**阶段一（只拉取 + 可选有头）**

1. **apps/browser-node**：连接、node.invoke.request 处理、`browser_fetch`、`BROWSER_HEADED` 控制 headless，node.invoke.result 回传。
2. **packages/agent-template**：新建 **browser_skill**（browser_nodes、browser_fetch_js），gatewayInvoke + BROWSER_NODE_ID 或 node.list 发现。
3. **packages/agent-from-dir**：将 browser_skill 加入 U_BASE_SKILL_NAMES 与 buildSessionFromU 的 mergedTools、executeTool 路由。
4. **文档**：apps.md / gateway.md / README 补充 Browser Node 启动与 browser_skill 使用说明。

**阶段二（有头 + 自动化）**

5. **apps/browser-node**：会话管理（sessionId ↔ Page）、`browser_session_start` / `browser_navigate` / `browser_click` / `browser_fill` / `browser_snapshot` / `browser_content` / `browser_session_end` 等 command，超时回收。
6. **Agent 侧**：在 browser_skill 中暴露上述会话类工具，sessionId 经 LLM 或会话状态在多轮中传递。
7. **有头**：`BROWSER_HEADED=1` 时用户可见窗口，用于调试与「人看 Agent 操作」的自动化。

以上即可把 WebKit 做成既有头又可自动化操作的 Node 类型，并与现有 node.invoke 协议兼容。

---

## 九、Docker 部署（含 Xvfb + VNC）与多节点端口设计

### 9.1 多节点与前端展示（CDP/截图为主，VNC 可选）

- **主流程：CDP/Playwright 截图**：Control UI「浏览器」Tab 以 **browser_screenshot** 为主——拉取 node.list 中 `capabilities` 含 `browser` 的节点，选择节点后点击「获取截图」调用 `node.invoke(..., "browser_screenshot")`，展示最近一次页面的 PNG base64。无需 VNC、无需额外端口，适合自动化测试与 Agent 执行浏览器任务（如发布文章）后查看结果。
- **browser_fetch** 默认带 `captureScreenshot: true`，执行后节点会更新「最近截图」，Control UI 或 Agent 可随时调 **browser_screenshot** 获取。
- **VNC 可选**：若需实时看桌面（如手动登录），节点可上报 `vncPort`，Control UI 可扩展支持 `/vnc/:port` 代理或用户用本地 VNC 客户端连 5900。

### 9.2 Docker 单节点

- **构建**：`docker build -t monou-browser-node -f apps/browser-node/Dockerfile apps/browser-node`
- **运行**：`docker run --rm --init -e GATEWAY_URL=ws://host.docker.internal:9347 -e BROWSER_HEADED=1 -p 6080:6080 -p 5900:5900 --add-host=host.docker.internal:host-gateway monou-browser-node`（entrypoint 设 `VNC_PORT=6080` 上报）
- **全流程测试**：`npm run test:browser-node-docker`；在 Control UI「浏览器」Tab 选择节点查看界面。

多节点时宿主机映射不同端口（如 `-p 6081:6080`），并传 `VNC_PORT=6081` 等，使节点上报宿主机端口。无头或仅持久化时不暴露 6080/5900，或 `BROWSER_HEADED=0`；`BROWSER_USER_DATA_DIR` 可挂 volume。

---

## 十、节点无显示器时如何让用户看到界面（如知乎需登录）

场景：用 browser 访问知乎 → 返回「需要登录」；节点在服务器/容器里跑、**没有物理显示器**，用户想**看到当前页面长什么样**（登录框、验证码等）以便决定如何操作。

### 方案对比

| 方案 | 做法 | 优点 | 缺点 |
|------|------|------|------|
| **A. 截图回传** | 检测到需登录（或任意时刻）时，Node 无头截屏，通过 node.invoke.result 把截图（base64 或临时 URL）返回；Control UI / TUI / Agent 展示或保存成文件给用户看 | 节点可一直无头、无显示器；实现简单（Playwright 已有 page.screenshot） | 看到的是**静态图**，不是实时窗口；需前端支持展示图片 |
| **B. Browser Node 跑在本机（有头）** | 把 Browser Node 进程跑在**用户有显示器的电脑**上，`BROWSER_HEADED=1`；Gateway/Agent 可在服务器，仅 Node 在本机连同一 Gateway | 用户直接看本机弹窗，无需额外基建 | 本机必须常开/能跑 Node；多用户时每人本机一个 Node 或共享一台有显示的机器 |
| **C. VNC + Xvfb** | 节点在服务器上：Xvfb 虚拟显示 + 有头浏览器 + VNC 服务；用户用 VNC 客户端或浏览器 noVNC 连到该 VNC，看到**实时**桌面与浏览器窗口 | 节点可放服务器，多人可连同一 VNC 看同一窗口（或每人一容器一 VNC） | 需在节点环境装并配置 Xvfb、VNC；有一定运维成本 |
| **D. 远程桌面到节点机器** | 节点跑在某台服务器；用户用 RDP/VNC 等远程桌面连到该服务器，在服务器上开有头浏览器或直接看已开的窗口 | 无需改 Browser Node 代码 | 依赖该服务器有桌面与远程桌面服务；和 C 类似但更重 |

### 推荐组合

1. **默认（节点无显示器）**：实现 **A. 截图回传**。  
   - 新增 command 如 `browser_screenshot`（或 `browser_fetch` 在检测到需登录时可选返回截图）：无头执行 `page.goto` 后 `page.screenshot()`，将 PNG base64 放入 `result.payload.screenshotBase64`（或写入临时文件并返回 URL）。  
   - Agent 或 Control UI 收到后：展示图片（如 `&lt;img src="data:image/png;base64,..."&gt;`）、或写入本地文件并提示用户打开。  
   - 这样「访问知乎 → 需登录」时，用户至少能**看到登录页长什么样**，再决定是去本机有头登录、还是提供 cookie 等。

2. **需要实时操作/登录**：用 **B** 或 **C**。  
   - **B**：需要手动登录、偶尔用 → 本机起 Browser Node（有头 + userDataDir），登录一次，后续无头节点可复用同一 profile。  
   - **C**：节点必须在服务器且要让人看到实时窗口 → 节点镜像/环境内 Xvfb + VNC，用户用 noVNC 或 VNC 客户端打开「当前浏览器」完成登录或观察。

### 实现要点（方案 A：截图回传）

- **browser_fetch** 在返回 content 前可检测「是否疑似登录页」（URL 或正文含登录/验证码等）；若检测到，同时截屏，在 `result.payload` 中增加 `screenshotBase64?: string`（或 `screenshotPath?: string` 若写文件）。  
- 或单独 command **browser_screenshot**：`params: { url?, sessionId? }`，对当前 page 或先 goto(url) 再截图，返回 base64。  
- **Control UI 图像模态**：tool 结果以 Markdown 字符串返回；若内容中含 `![alt](data:image/png;base64,...)`，Control UI 的对话用 ReactMarkdown 渲染时会展示为图片，即**支持图像模态**。browser_skill 的 **browser_fetch** 在返回正文时附带截图并写成上述 Markdown，故 Agent 执行 browser_fetch 后，用户可在对话里直接看到页面截图。  
- **参考 OpenClaw**：OpenClaw 的 Control UI 曾存在「chat 不渲染 image attachments」的诉求（见 openclaw/openclaw#24021）；本方案通过「截图嵌入 tool 结果 Markdown」在对话中展示图像，无需单独 attachment 协议。TUI 可写临时文件并提示「已保存到 xxx，请打开查看」。

## 下一步

- 节点能力与 Control UI 接入：[control-ui/node-capabilities](../control-ui/node-capabilities.md)
- Gateway 与 node.invoke：[gateway](../runtime/gateway.md)
- 应用与 sandbox-node：[apps](../runtime/apps.md)
