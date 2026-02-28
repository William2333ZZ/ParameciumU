# 新主机加入：检查 OS、有无 monoU、复制、再创建智能体

当用户要求在**另一台主机**上创建智能体时，按以下顺序执行。认证（SSH 密码或密钥）由用户提供，不要写死在技能里。

## 1. 检查对方主机

用 **bash** 通过 SSH 执行一条命令，判断系统类型和是否已有 monoU：

- **Linux/macOS**：`ssh REMOTE_USER@REMOTE_HOST "uname -a"`
- **Windows**：`ssh REMOTE_USER@REMOTE_HOST "cmd /c \"echo %OS%\""`，若输出含 `Windows_NT` 则为 Windows。

**重要**：远程为 Windows 时，SSH 下默认是 **cmd**，没有 `which`、`ls` 等 Unix 命令。一律用 `cmd /c "..."`，路径用 `monoU`（用户主目录下）或 `C:\Users\用户名\monoU`。

再检查是否已有 monoU：

- Linux/mac：`ssh ... "test -d monoU && echo HAS_MONOU || echo NO_MONOU"`
- Windows：`ssh ... "cmd /c \"if exist monoU echo HAS_MONOU\""`，或 `ssh ... "cmd /c \"if exist C:\\Users\\用户名\\monoU echo HAS_MONOU\""`

若输出为 NO_MONOU 或没有 HAS_MONOU，则需先复制 monoU。

## 2. 复制 monoU 到新主机

### 2.1 远程为 Linux 或 macOS

用 **rsync**（远程需有 rsync）或 **deploy-to-remote.sh**：

```bash
REMOTE_USER=用户提供的用户 REMOTE_HOST=用户提供的IP或主机名 REMOTE_PATH=~/
./.u/skills/agent-creator/scripts/deploy-to-remote.sh
```

或手写 rsync（需本机有 sshpass 时可将密码通过环境变量传入，或用户已配置密钥）：

```bash
rsync -avz --exclude node_modules --exclude .git --exclude dist -e "ssh ..." ./ REMOTE_USER@REMOTE_HOST:REMOTE_PATH/monoU/
```

### 2.2 远程为 Windows

Windows 上通常没有 rsync。用 **tar + scp**：

1. 在本机 monoU 根目录打 tar 包（排除 node_modules、.git、dist）：
   ```bash
   tar --exclude=node_modules --exclude=.git --exclude=dist -czf /tmp/monoU-sync.tar.gz .
   ```
2. 用 scp 上传到远程用户主目录：
   ```bash
   scp /tmp/monoU-sync.tar.gz REMOTE_USER@REMOTE_HOST:monoU-sync.tar.gz
   ```
3. SSH 到远程解压到 monoU 目录：
   ```bash
   ssh REMOTE_USER@REMOTE_HOST "if not exist monoU mkdir monoU && tar -xzf monoU-sync.tar.gz -C monoU"
   ```

（认证方式由用户提供，例如 sshpass -p 或已配置的密钥。）

## 3. 在远程执行 npm install 与 build

SSH 到远程，在 monoU 目录下：

- **Linux/macOS**：`cd monoU && npm install && npm run build`
- **Windows**：`cd monoU && npm install`，然后按包依赖顺序 build（若根目录 `npm run build` 因脚本路径失败，可依次在 `packages/llm-provider`、`packages/agent-template`、`packages/agent-from-dir`、`packages/tui`、`packages/gateway`、`apps/gateway` 下执行 `npm run build`），确保 `apps/agent/dist/index.js` 存在。

## 4. 在远程创建 Agent 并启动连接

### 4.1 Linux/macOS

在远程 monoU 根目录执行（或通过 SSH 执行）：

```bash
AGENT_DIR=$(pwd)/agents/<agent_id> MONOU_ROOT=$(pwd) SKILLS="base_skill memory cron" ./.u/skills/agent-creator/scripts/create-agent-dir.sh
nohup env GATEWAY_URL=ws://<本机可达地址>:18790 AGENT_ID=<agent_id> AGENT_DIR=$(pwd)/agents/<agent_id> ./.u/skills/agent-creator/scripts/start-agent-client.sh >> .gateway/agent-<agent_id>.log 2>&1 &
```

### 4.2 Windows

远程没有 .sh 脚本时，推荐：

- **方式 A（推荐）**：在本机用 create-agent-dir.sh 生成 `agents/<agent_id>`，再 tar 该目录并 scp 到远程，SSH 解压到 `monoU/agents/`（例如 `mkdir monoU\agents 2>nul & tar -xzf agent_xxx.tar.gz -C monoU\agents` 或先解压再 move 到 agents）。
- **方式 B**：在远程用 PowerShell 或 cmd 创建与 .u 同构的目录并复制 SOUL.md、IDENTITY.md、cron/jobs.json、skills（从模板或本机 .u/skills 复制 base_skill、memory、cron）。会话由 Gateway 管理，无需 chat.json。

启动 agent-client（Windows 下**必须用绝对路径**作为 AGENT_DIR，例如 `C:\Users\用户名\monoU\agents\win_agent`；不要依赖 `%CD%`，因通过 SSH 传参时可能未正确展开）：

```cmd
cd /d C:\Users\用户名\monoU
set GATEWAY_URL=ws://<本机可达地址>:18790
set AGENT_ID=win_agent
set AGENT_DIR=C:\Users\用户名\monoU\agents\win_agent
node apps\gateway\dist\agent-client.js
```

**持久运行（推荐）**：通过 SSH 执行 `start /b` 时，SSH 断开后进程会退出。改用**计划任务**在远程启动：在本机运行 **scripts/start-remote-windows-agent.sh**（需设 REMOTE_USER、REMOTE_HOST、AGENT_ID、GATEWAY_URL、REMOTE_MONOU 等），脚本会生成 .bat、scp 到远程、创建计划任务并触发运行，agent 在 SSH 断开后仍保留。详见 [remote-windows-start.md](remote-windows-start.md)。

其他方式：在本机写好 .bat 并 scp 到远程 monoU，在远程手动双击运行或 `start /b 脚本.bat`（后者在 SSH 断开后可能被终止）；或保持 SSH 会话在前台运行 `node apps\gateway\dist\agent-client.js`。

## 5. 本机 Gateway 对远程可见

远程 agent-client 要连的是**本机** Gateway。本机需：

- 使用 `GATEWAY_HOST=0.0.0.0` 启动 Gateway，或
- 做 SSH 反向隧道等，使远程能访问本机端口。

详见 [gateway-connect.md](gateway-connect.md)。
