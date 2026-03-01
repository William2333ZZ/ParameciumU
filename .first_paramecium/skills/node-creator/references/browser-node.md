# Browser Node

## What it is

`apps/browser-node` connects to the Gateway as `role=node` with `capabilities: ["browser"]`. It runs a Playwright WebKit browser (headless by default) and executes browser commands on demand via `node.invoke`.

The browser stays open between calls — login state and cookies persist as long as the process is running (and permanently if `BROWSER_USER_DATA_DIR` is set).

## Quick start

```bash
GATEWAY_URL=ws://127.0.0.1:9347 \
BROWSER_USER_DATA_DIR=.gateway/browser-profile \
"$AGENT_DIR/skills/node-creator/scripts/start-browser-node.sh"
```

Or directly from the monoU root:

```bash
GATEWAY_URL=ws://127.0.0.1:9347 \
BROWSER_USER_DATA_DIR=.gateway/browser-profile \
npm run browser-node
```

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GATEWAY_URL` | — | Gateway WebSocket address (**required**) |
| `BROWSER_NODE_ID` | `browser-1` | Node ID used in `gateway_nodes_list` and `gateway_node_invoke` |
| `BROWSER_USER_DATA_DIR` | *(none)* | Directory to persist browser profile (cookies, login state). **Strongly recommended.** |
| `BROWSER_HEADED` | *(unset)* | Set to `1` for a visible browser window — useful for first login or debugging |

## Supported commands (via `gateway_node_invoke`)

| Command | Key params | Description |
|---------|-----------|-------------|
| `browser_fetch` | `url` or `currentPageOnly: true` | Open URL and return page text + screenshot. Pass `currentPageOnly: true` to screenshot the current page without navigating (e.g. after a modal opens). |
| `browser_screenshot` | — | Return a screenshot of the current page without navigating. |
| `browser_links` | — | List all links on the current page (text + href). |
| `browser_click` | `text` or `selector`, optional `waitAfterMs` | Click an element by visible text or CSS selector. |
| `browser_fill` | `text`, `selector` or `placeholder` | Clear and fill an input field. |
| `browser_pages` | — | List all open tabs (index + URL). |
| `browser_switch` | `index` | Switch to a tab by index. |
| `browser_new_tab` | optional `url` | Open a new tab, optionally navigate to a URL. |

All commands return `{ ok, payload }` or `{ ok: false, error }`.

## Multi-step browser workflow

```
browser_fetch(url)          → opens page, returns text + screenshot
browser_links()             → list all links
browser_click("Sign in")    → click a button
browser_fill({ placeholder: "Email", text: "..." })
browser_fetch({ currentPageOnly: true })  → screenshot after action
```

## Docker (headless with VNC for debugging)

The Docker image includes Xvfb + x11vnc + noVNC. Use when running on a server without a display.

```bash
# Build (from monoU root)
docker build -t monou-browser-node -f apps/browser-node/Dockerfile apps/browser-node

# Run (Gateway must already be running on port 9347)
docker run --rm --init \
  -e GATEWAY_URL=ws://host.docker.internal:9347 \
  -e BROWSER_HEADED=1 \
  -p 6080:6080 -p 5900:5900 \
  --add-host=host.docker.internal:host-gateway \
  monou-browser-node
```

Open **http://localhost:6080/vnc.html** to see the browser window inside the container.

## Prerequisites

- `npm run build` in monoU root (builds `apps/browser-node/dist/index.js`).
- WebKit browser: `npx playwright install webkit`.

## Troubleshooting: node disconnects (`node not found: browser-1`)

Common causes:
1. **Page timeout**: heavy pages (e.g. Zhihu) may time out; the node auto-extends timeout for known slow sites.
2. **WebKit crash**: complex scripts can crash the browser process; the node has `unhandledRejection` guards but may still exit.
3. **Concurrent requests**: only one `browser_fetch` runs at a time; others return "node busy, try again".
4. **Gateway restart / network drop**: the node process exits on WebSocket close — restart it to reconnect.

Restart the node process to recover.
