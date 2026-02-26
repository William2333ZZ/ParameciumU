# Browser Node

以 **role=node** 连接 monoU Gateway，声明 `capabilities: ["browser"]`，用 Playwright WebKit 执行 `browser_fetch` 等，供 Agent 通过 node.invoke 做「执行 JS 后抓取页面」或后续自动化操作。

其他 Agent 可通过 **node.list** 看到本节点带 `capabilities: ["browser"]`，从而知道有浏览器能力可用（类似 MCP 的发现）。

## 用法

```bash
# 必填
export GATEWAY_URL=ws://127.0.0.1:9347

# 可选：节点 ID（默认 browser-1），用于 node.list / node.invoke 目标
export BROWSER_NODE_ID=browser-1

# 可选：有头模式（可见窗口），便于本机登录或调试
# export BROWSER_HEADED=1

# 可选：浏览器 profile 持久化目录（**建议配置**，否则每次重启无登录态）
# 设为项目下 .gateway/browser-profile 可与 Gateway 数据放一起
export BROWSER_USER_DATA_DIR=.gateway/browser-profile

npm run browser-node
# 或从仓库根一条命令（含用户目录，登录态会保留）：
# GATEWAY_URL=ws://127.0.0.1:9347 BROWSER_USER_DATA_DIR=.gateway/browser-profile npm run browser-node
```

## 协议

- **connect**：`role: "node"`, `deviceId: BROWSER_NODE_ID`, `capabilities: ["browser"]`
- **node.invoke.request** 支持：
  - `command: "browser_fetch"`，`params`: `{ url?, currentPageOnly?, timeoutMs?, captureScreenshot?, waitAfterLoadMs?, waitUntil? }`。传 `currentPageOnly: true` 时不跳转，仅对当前页截图+取正文（用于弹窗/私信框出现后截屏）。`waitUntil`: `domcontentloaded`（默认）| `load` | `networkidle`。**浏览器不关闭**，登录态保留。
  - `command: "browser_screenshot"` → 返回最近一次截图的 base64。
  - `command: "browser_links"` → 获取当前页所有链接（text + href），便于找「我的主页」等再打开或点击。
  - `command: "browser_click"`，`params`: `{ text? }` 或 `{ selector? }`，可选 `waitAfterMs`（点击后等待毫秒再截图返回）。
  - `command: "browser_fill"`，`params`: `{ text, selector? }` 或 `{ text, placeholder? }` → 在输入框填入内容（先清空再填）。
  - `command: "browser_pages"` → 列出当前所有 tab 的 index 与 url（需持久化 context）。
  - `command: "browser_switch"`，`params`: `{ index: number }` → 切换到指定 tab。
  - `command: "browser_new_tab"`，`params`: `{ url?: string }` → 新开 tab，可选打开 url（需 BROWSER_USER_DATA_DIR）。

## 为什么节点会断线（node not found: browser-1）

常见原因：

1. **页面加载过慢或超时**：知乎等重页面在默认超时内未加载完，会报错；已对登录页等自动延长超时，并做串行化避免并发。
2. **WebKit/Playwright 崩溃**：个别复杂页或脚本可能导致 WebKit 进程崩溃，进而 Node 进程退出；已加 try/catch 与 unhandledRejection 防护，减少未捕获异常导致退出。
3. **并发多个 browser_fetch**：同时跑多个会起多个浏览器实例，容易 OOM 或崩溃；现已改为**同一时间只执行一个** browser_fetch，其余返回「节点正忙，请稍后再试」。
4. **Gateway 重启或网络闪断**：WebSocket 断开后本进程会主动 exit，需重新启动 browser-node。

断线后把 browser-node 重新跑起来即可，Gateway 会再次识别到节点。

## 构建与依赖

需安装 WebKit：`npx playwright install webkit`。持久化 profile（cookie/登录态）通过 `BROWSER_USER_DATA_DIR` + `launchPersistentContext` 实现。

```bash
npm run build
```

## Docker（Xvfb + VNC，无显示器时通过浏览器看界面）

镜像内带 Xvfb + x11vnc + noVNC，有头模式时浏览器窗口画在虚拟显示上，可通过浏览器打开 noVNC 查看（例如访问知乎出现登录页时可在 noVNC 里看到）。

```bash
# 构建（在仓库根目录）
docker build -t monou-browser-node -f apps/browser-node/Dockerfile apps/browser-node

# 运行（Gateway 需已启动，端口 9347；Mac/Windows 用 host.docker.internal 指宿主机）
docker run --rm --init \
  -e GATEWAY_URL=ws://host.docker.internal:9347 \
  -e BROWSER_HEADED=1 \
  -p 6080:6080 -p 5900:5900 \
  --add-host=host.docker.internal:host-gateway \
  monou-browser-node
```

浏览器打开 **http://localhost:6080/vnc.html** 即可看到容器内浏览器窗口。

全流程测试（Gateway + Docker Browser Node + Agent，访问知乎并提示 noVNC 地址）：

```bash
npm run build
npm run test:browser-node-docker
```
