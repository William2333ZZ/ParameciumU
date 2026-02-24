# Sandbox Node（方案 B）

以 **role=node** 连接 monoU Gateway，声明 `capabilities: ["sandbox"]`，在隔离 workspace 内执行 `system.run` / `system.which`，供 `node.invoke` 定向调用。详见 [docs/sandbox-openclaw-pimono-and-monou.md](../../docs/sandbox-openclaw-pimono-and-monou.md)。

## 用法

```bash
# 必填
export GATEWAY_URL=ws://127.0.0.1:18789

# 可选：节点 ID（默认 sandbox-1），用于 node.list / node.invoke 目标
export SANDBOX_NODE_ID=sandbox-1

# 可选：沙箱工作目录，命令在此目录下执行；默认 os.tmpdir()/monou-sandbox-<nodeId>
export SANDBOX_WORKSPACE=./.sandbox

# 可选：禁用 Docker 时用本机目录+子进程（默认用 Docker）
# export SANDBOX_USE_DOCKER=0
export SANDBOX_IMAGE=debian:bookworm-slim

npm run sandbox-node
# 或从仓库根：GATEWAY_URL=ws://127.0.0.1:18789 npm run sandbox-node
```

**默认 Docker**：使用长驻容器 + `docker exec` 执行命令，与 OpenClaw 一致。设 **SANDBOX_USE_DOCKER=0** 时退化为本机目录 + 子进程（无容器）。

## 协议

- **connect**：`role: "node"`, `deviceId: SANDBOX_NODE_ID`, `capabilities: ["sandbox"]`
- **node.invoke.request** 支持：
  - `command: "system.run"`，`paramsJSON`: `{ "command": ["cmd", "arg1"], "rawCommand": "可选原始字符串" }` → 在沙箱目录下执行，返回 `exitCode`、`stdout`、`stderr`
  - `command: "system.which"`，`paramsJSON`: `{ "bins": ["node", "python3"] }` → 返回 `{ "bins": { "node": "/path", "python3": "/path" } }`

## 构建

```bash
npm run build
```
