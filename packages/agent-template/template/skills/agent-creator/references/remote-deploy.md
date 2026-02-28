# 远程部署 Agent

在另一台机器上运行 ParameciumU Agent 并连接到本机或公网 Gateway 的步骤。

## 环境要求

- **Node.js >= 20**
- 若该 agent 需要调用 LLM：配置 `OPENAI_API_KEY` 或 `AIHUBMIX_API_KEY`、`AIHUBMIX_BASE_URL`（可复制项目根目录 `env.example` 为 `.env`）

## 步骤概览

1. 将 monoU 仓库同步到远程机器（git clone 或 rsync/scp）。
2. 在远程机器上安装依赖并构建：
   ```bash
   npm install
   npm run build
   ```
3. 配置环境变量并启动 agent：
   - `GATEWAY_URL`：Gateway 的 WebSocket 地址（本机可填 `ws://<本机内网IP>:9347`，公网需可访问的 ws 地址）。
   - `AGENT_ID`：该 agent 的唯一 ID（如 `remote-agent-1`）。
   - `AGENT_DIR`：该 agent 的目录，与 `.first_paramecium` 同构；可指向 `./.first_paramecium` 或 `./agents/<AGENT_ID>`（需先通过 ensureAgentDir 或复制 template 生成）。
4. 启动命令示例：
   ```bash
   GATEWAY_URL=ws://192.168.1.100:9347 AGENT_ID=remote-agent-1 AGENT_DIR=./.first_paramecium node apps/agent/dist/index.js
   ```
   若使用独立 agent 目录（如 `agents/remote-agent-1`），先确保目录存在（从模板复制或运行 `ensureAgentDir`），再设置 `AGENT_DIR=./agents/remote-agent-1`。

## 与 Gateway 的连通性

- 远程 agent 必须能访问 `GATEWAY_URL`（防火墙、端口、TLS 等需自行配置）。
- 若 Gateway 在本机，需在 Gateway 所在机器开放对应端口，并确保远程机器能解析并连接该地址。

## 可选：认证

若 Gateway 启用了 `GATEWAY_TOKEN` 或 `GATEWAY_PASSWORD`，在启动 agent 时同样设置对应环境变量，连接时首条消息会携带认证信息。
