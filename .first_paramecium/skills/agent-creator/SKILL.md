---
name: agent-creator
description: "创建新的 monoU 智能体（Agent）并连接 Gateway。仅当用户说「创建智能体」「新建 agent」「新建一个智能体」时使用；先 read 本技能 SKILL.md，再按技能内步骤执行。本机：用 bash 执行 create-and-connect.sh。新主机加入：先检查对方 OS（Linux/mac 或 Windows）及是否已有 monoU；无则复制（Linux/mac 用 rsync，Windows 用 tar+scp），再在远程 npm install 与 build，再创建 agent 并启动 agent-client 连本机 Gateway。不要用 cron 技能（cron_add 等）创建智能体。"
---

# Agent Creator

创建新的 monoU Agent（智能体）：在**新目录**建与 `.u` 同构的文件，并启动 agent-client 连接本机 Gateway，使新 Agent 在 Control UI 可见。**不要修改当前 `.u` 目录**；必须新建 `agents/<agent_id>/` 这类目录。

**你收到「创建智能体」「新建 agent」请求时**：先 **read** 本文件（`.u/skills/agent-creator/SKILL.md`），再按下面「本机创建并连接 Gateway」用 **bash** 执行 `create-and-connect.sh`，传入用户给的 agent 名字和 Gateway 端口。不要调用 cron_add、cron_list 等 cron 工具。

## 何时用本技能 / 何时用 cron

- 用户说**创建智能体、新建 agent** → 用本技能。
- 用户说**定时任务、cron、提醒、调度** → 用 **cron** 技能。

## 本机创建并连接 Gateway（推荐：一条命令完成）

在 monoU 根目录用 **bash** 执行本技能的一键脚本，传入 `AGENT_ID` 和（可选）`GATEWAY_URL`：

```bash
AGENT_ID=<新 agent 名字> GATEWAY_URL=ws://127.0.0.1:18790 ./.u/skills/agent-creator/scripts/create-and-connect.sh
```

- `<新 agent 名字>`：如用户指定的名字，或 `test_agent`。会创建 `agents/<AGENT_ID>/` 并复制 SOUL、IDENTITY、base_skill、memory、cron。
- `GATEWAY_URL`：本机 Gateway，默认 `ws://127.0.0.1:18790`（与 Control UI 默认端口一致）。
- `DEVICE_ID`：可选；默认本机 hostname，同机多 Agent 在节点图中会聚成**一台设备**；设 `DEVICE_ID=$AGENT_ID` 则一 Agent 一节点。
- 脚本会**后台**启动 agent-client，不会卡住；执行完后在 Control UI 可见该 Agent。

若需先定制灵魂再连：先执行下面「分步执行」的 1、2，再执行 3（后台启动连接）。

## 新主机加入：先检查再复制 monoU，再一步一步创建智能体

当要在**新主机（远程）**上创建智能体时，顺序必须是：

1. **检查对方主机**：用 SSH 判断是 Linux/macOS 还是 Windows（如 `uname -a` 或 `cmd /c echo %OS%`），并检查是否已有 monoU（如 `test -d monoU` 或 Windows 下 `if exist monoU`）。若没有 monoU，则执行第 2 步；若有则可跳到第 3 步。
2. **复制 monoU**：若远程为 Linux/macOS，用 rsync 或 deploy-to-remote.sh；若为 **Windows**，用 **tar 打包（排除 node_modules/.git/dist）+ scp 上传 + 远程解压到 monoU**（Windows 上一般没有 rsync）。详见 [references/remote-new-host.md](references/remote-new-host.md)。
3. **在远程执行**：在**该主机**的 monoU 目录下执行 `npm install` 与 `npm run build`（Windows 若根目录 build 失败，需按依赖顺序在 packages/llm-provider、agent-template、agent-from-dir、tui、gateway 及 apps/gateway 下分别 build）。
4. **然后**在新主机上创建 Agent 目录、（可选）定制 SOUL/IDENTITY、后台启动 agent-client；`GATEWAY_URL` 填**本机**对新主机可达的地址（先向用户获取）。Linux/mac 用脚本；Windows 用 `set GATEWAY_URL=...` 与 `node apps\gateway\dist\agent-client.js`，AGENT_DIR 用**绝对路径**。

完整命令与 Windows 细节见 [references/remote-new-host.md](references/remote-new-host.md)。认证（SSH 密码或密钥）由用户提供，不要写死在技能或脚本里。

## 分步执行（需定制 SOUL/IDENTITY 或远程/新主机时）

1. **创建 Agent 目录**（在**目标机器**的 monoU 根目录用 bash）：
   ```bash
   AGENT_DIR=$(pwd)/agents/<agent_id> MONOU_ROOT=$(pwd) SKILLS="base_skill memory cron" ./.u/skills/agent-creator/scripts/create-agent-dir.sh
   ```
   将 `<agent_id>` 换成实际 ID。若是新主机，确保已先完成「复制 monoU + npm install + npm run build」。

2. **（可选）定制 SOUL/IDENTITY**：用 **write** 或 **edit** 修改 `agents/<agent_id>/SOUL.md`、`agents/<agent_id>/IDENTITY.md`。参考 [references/soul-and-identity.md](references/soul-and-identity.md)。

3. **启动连接（后台）**：在**目标机器**上用 bash 在**后台**运行 start-agent-client：
   ```bash
   nohup env GATEWAY_URL=ws://<本机可达地址>:18790 AGENT_ID=<agent_id> AGENT_DIR=$(pwd)/agents/<agent_id> ./.u/skills/agent-creator/scripts/start-agent-client.sh >> .gateway/agent-<agent_id>.log 2>&1 &
   ```
   本机创建时 `GATEWAY_URL=ws://127.0.0.1:18790`；新主机创建时 `GATEWAY_URL` 必须是本机对新主机可达的地址（先向用户获取）。执行前若 gateway 未 build，先 `npm run build --workspace=@monou/gateway-app`。

## 脚本与参考资料

| 资源 | 用途 |
|------|------|
| **scripts/create-and-connect.sh** | 一键：建目录 + 后台连 Gateway（本机推荐） |
| scripts/create-agent-dir.sh | 仅创建 AGENT_DIR（需已设 AGENT_DIR、MONOU_ROOT） |
| scripts/start-agent-client.sh | 仅启动 agent-client（需 GATEWAY_URL、AGENT_ID、AGENT_DIR；若前台运行会阻塞，请用 nohup ... &） |
| scripts/deploy-to-remote.sh | 新主机加入时：把 monoU 同步到远程（需 REMOTE_USER、REMOTE_HOST、REMOTE_PATH） |
| **scripts/start-remote-windows-agent.sh** | **远程 Windows**：用计划任务启动 agent-client，SSH 断开后进程仍保留（需 REMOTE_USER、REMOTE_HOST、AGENT_ID、GATEWAY_URL、REMOTE_MONOU；可选 SSHPASS、KILL_FIRST=1） |
| scripts/get-local-gateway-url.sh [端口] | 获取本机 IP 与对方可用的 GATEWAY_URL |
| [references/remote-new-host.md](references/remote-new-host.md) | **新主机完整流程**：检查 OS、是否已有 monoU → 复制（Linux/mac 用 rsync，Windows 用 tar+scp）→ 远程 npm install/build → 创建 agent → 启动 agent-client |
| [references/remote-windows-start.md](references/remote-windows-start.md) | **远程 Windows 持久启动**：计划任务 + .bat，本机一键脚本说明 |
| [references/remote-deploy.md](references/remote-deploy.md) | rsync 用法、远程 npm install/build、环境变量 |
| [references/gateway-connect.md](references/gateway-connect.md) | 本机/远程 Gateway 地址确认 |
| [references/soul-and-identity.md](references/soul-and-identity.md) | 撰写 SOUL、IDENTITY |
| [references/skill-library.md](references/skill-library.md) | 技能库与复制到新 Agent |
