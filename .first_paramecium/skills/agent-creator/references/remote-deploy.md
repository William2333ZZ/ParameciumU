# 远程部署 monoU 与 Agent 连接

## 将 monoU 复制到远程主机

### rsync（推荐）

从**本机 monoU 根目录**执行，将整个仓库同步到远程（排除 node_modules、.git 等可加快速度）：

```bash
rsync -avz --exclude 'node_modules' --exclude '.git' --exclude 'dist' \
  ./ REMOTE_USER@REMOTE_HOST:REMOTE_PATH/monoU/
```

- `REMOTE_USER`：远程 SSH 用户。
- `REMOTE_HOST`：远程主机名或 IP。
- `REMOTE_PATH`：远程上的基路径，例如 `~/` 或 `/opt/`。

同步后在远程执行：

```bash
cd REMOTE_PATH/monoU && npm install && npm run build
```

（若使用 pnpm：`pnpm install && pnpm run build`。）

### 环境变量（远程）

远程运行 agent-client 前需配置：

- `OPENAI_API_KEY` 或 `AIHUBMIX_API_KEY`（及可选 `AIHUBMIX_BASE_URL`、`OPENAI_BASE_URL`）：LLM 调用。
- `GATEWAY_URL`：**本机 Gateway** 的 WebSocket 地址（远程必须能访问到本机）。
- `AGENT_ID`、`AGENT_DIR`：见 SKILL.md 第 3 步。

### 本机 Gateway 对远程可见

- 若 Gateway 在本机 `127.0.0.1:18790`，远程无法直接连。可选：
  - 在本机用 SSH 反向隧道：`ssh -R 18790:127.0.0.1:18790 REMOTE_USER@REMOTE_HOST`，远程则设 `GATEWAY_URL=ws://127.0.0.1:18790`。
  - 或在本机绑定 `0.0.0.0:18790` 并开放防火墙，远程用 `GATEWAY_URL=ws://<本机公网或内网IP>:18790`（注意安全与认证，见 gateway-security-and-transport）。

## 在远程启动 agent-client

在远程 monoU 根目录下（或设置好 `AGENT_DIR` 指向该 Agent 目录）：

```bash
export GATEWAY_URL=ws://<本机可达地址>:18790
export AGENT_ID=my_remote_agent
export AGENT_DIR=/path/on/remote/to/agent_dir
node apps/gateway/dist/agent-client.js
```

需先在本机执行 `npm run build`（或 pnpm build）并同步 `dist`，或直接在远程执行 `npm run build`。
