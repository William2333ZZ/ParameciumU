---
title: "Browser node design"
summary: "WebKit as a Node type, node.invoke and browser capability, headed/headless and Control UI."
read_when:
  - Integrating or extending the browser node
  - Understanding node.invoke and capabilities
---

# Browser node design (WebKit as Node type)

## 1. Goals

- **Agent process stays light:** No Playwright/WebKit inside the agent; agents call **node.invoke** via the Hub.
- **Browser as a Node:** Separate process connects with `role=node`, declares `capabilities: ["browser"]`.
- **Shared:** Multiple agents can use the same Browser Node.
- **Protocol:** Same node.invoke / node.invoke.request / node.invoke.result as other nodes (e.g. sandbox-node).

**Extensions:** Headed mode (`headless: false`) for debugging or "human watches agent" flows; multi-step automation (navigate → click, fill → snapshot).

---

## 2. Identity and connection

| Item | Convention |
|------|------------|
| **role** | `"node"` |
| **deviceId / nodeId** | Env `BROWSER_NODE_ID`, default `browser-1` (for node.list and node.invoke target) |
| **capabilities** | `["browser"]` so Hub/UI can distinguish from sandbox and other nodes |
| **Connect** | WebSocket to Hub; first message `connect` with role, nodeId, optional token/password |

Callers use **node.list** to see nodes and **node.invoke(nodeId, command, params)** to run browser commands.

---

## 3. node.invoke protocol (browser side)

Caller sends:

```ts
// RPC: node.invoke
{ method: "node.invoke", params: { nodeId: "browser-1", command: "browser_fetch", params: { url: "https://..." } } }
```

Hub forwards `{ id, nodeId, command, params, timeoutMs? }` as **node.invoke.request** to the Browser Node. Node runs the command and replies with **node.invoke.result** (`{ ok, payload?, error? }`).

### 3.1 Commands

**Stateless (one-shot)**

| command | Description | params |
|---------|-------------|--------|
| **browser_fetch** | Open URL in WebKit, run JS, return body text | `url` (required), `timeoutMs?` (default 15000) |

**Session (stateful)**

One session = one page; multiple commands in the same session (navigate, click, fill, snapshot).

| command | Description | params |
|---------|-------------|--------|
| **browser_session_start** | Create session (new page), return sessionId | `timeoutMs?` |
| **browser_navigate** | Open URL in session | `sessionId`, `url`, `timeoutMs?` |
| **browser_click** | Click element | `sessionId`, `selector` (CSS or text=…), `timeoutMs?` |
| **browser_fill** | Clear and fill input/textarea | `sessionId`, `selector`, `value` |
| **browser_type** | Type text (keyboard simulation) | `sessionId`, `selector`, `text`, `delayMs?` |
| **browser_snapshot** | Get readable snapshot (a11y tree or simplified DOM) for next step | `sessionId`; optional `role?` filter |
| **browser_content** | Get main text content (same as browser_fetch content) | `sessionId`, `maxLength?` |
| **browser_screenshot** | Screenshot (base64 or path) | `sessionId` |
| **browser_session_end** | Close session, release page | `sessionId` |

`sessionId` comes from **browser_session_start**; subsequent commands must include it. Sessions can timeout or be recycled after process restart.

### 3.2 Result format

- **Success:** `result: { ok: true, payload: { content?: string, sessionId?: string, ... } }`. For browser_fetch/browser_content, `content` is body text (e.g. truncated at 80k chars).
- **Failure:** `result: { ok: false, error: { code: string, message: string } }` (e.g. timeout, navigation error).

---

## 4. Implementation notes

- **App:** `apps/browser-node` (same level as sandbox-node). Dependency: **playwright** with **WebKit only** (`npx playwright install webkit`; `import { webkit } from "playwright"`).
- **Headless (default):** `webkit.launch({ headless: true })`. **Headed:** Env `BROWSER_HEADED=1` → `headless: false`; window appears on the **machine where the Browser Node process runs**. For "human logs in once", run browser-node on a machine with a display, or use Xvfb + VNC.
- **Profile:** Env **BROWSER_USER_DATA_DIR** → `webkit.launch({ userDataDir })` so cookies/login state persist across restarts. Useful for sites that need login (use headed once to log in, then headless can reuse the profile).
- **Lifecycle:** browser_fetch = one-off page, no session. Session commands = maintain `sessionId → Page` map; browser_session_end or timeout clears it. One browser instance per process; multiple pages/contexts for multiple sessions.
- **Security:** Only http/https URLs; optional domain allowlist. Per-command and session timeouts.

---

## 5. Agent side: browser_skill

- **browser_nodes:** List nodes with `capabilities` including `"browser"` (from node.list). Agent uses this to see if a Browser Node is available.
- **browser_fetch_js:** Fetch a URL with JS execution (for SPA/heavy JS). Params: `url`. Implementation: resolve nodeId (config or from node.list), then `gatewayInvoke("node.invoke", { nodeId, command: "browser_fetch", params: { url } })`, return `result.payload.content`.
- **Session tools (optional):** browser_session_start, browser_navigate, browser_click, browser_fill, browser_snapshot, browser_content, browser_screenshot, browser_session_end — each tool calls node.invoke with the same command name and params. sessionId can be returned to the LLM and passed in later tool calls, or stored in agent/session state.

Agents choose **browser_fetch_js** when the page is SPA/JS-heavy; otherwise **web_fetch** (plain HTTP) in web_skill.

---

## 6. Control UI

- **Node capabilities:** Control UI filters nodes with `capabilities.includes("browser")` and can show a **Browser** panel (e.g. browser_screenshot). See [node-capabilities](../control-ui/node-capabilities.md).
- **Headed:** If Browser Node runs with BROWSER_HEADED=1 on the same machine as the user, they can watch the browser window while the agent operates.

---

## 7. Env vars (summary)

| Var | Scope | Description |
|-----|--------|-------------|
| GATEWAY_URL | browser-node | Required; Hub WebSocket URL |
| BROWSER_NODE_ID | browser-node | nodeId, default `browser-1` |
| BROWSER_HEADED | browser-node | 1 = headed, 0 or unset = headless |
| BROWSER_USER_DATA_DIR | browser-node | Persist cookies/login state |

## Next steps

- [Node capabilities](../control-ui/node-capabilities.md)
- [Gateway protocol](../gateway/protocol.md)
- [Apps](../runtime/apps.md)
