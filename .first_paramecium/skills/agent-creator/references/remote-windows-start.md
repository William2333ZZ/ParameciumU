# 远程启动 Windows Agent（持久化）

通过 SSH 在远程 Windows 上执行 `start /b node ...` 时，SSH 断开后该进程会随会话结束而被终止，agent 无法持续连接 Gateway。

**推荐**：在远程 Windows 上用**计划任务**启动 agent-client。计划任务由系统在独立会话中执行，不依赖 SSH，断开 SSH 后进程仍会保留。

## 流程概览

1. 在远程 monoU 目录下放一个 **.bat**，内容为设置 `GATEWAY_URL`、`AGENT_ID`、`AGENT_DIR` 并执行 `node apps\gateway\dist\agent-client.js`。
2. 在远程创建**计划任务**，动作为运行该 .bat（任务可设为「按需运行」或「一次性」未来时间，仅通过 `schtasks /run` 触发）。
3. 需要启动/重启 agent 时，本机 SSH 执行：先结束已有 `node.exe`（可选），再 `schtasks /run /tn <任务名>`。

认证（SSH 密码或密钥）由用户提供，不要写死在技能或脚本里。

## 1. .bat 内容示例

在远程 `C:\Users\用户名\monoU\start-<agent_id>.bat`：

```bat
@echo off
cd /d C:\Users\用户名\monoU
set GATEWAY_URL=ws://本机IP:18790
set AGENT_ID=win_agent2
set AGENT_DIR=C:\Users\用户名\monoU\agents\win_agent2
node apps\gateway\dist\agent-client.js
```

路径必须用**绝对路径**，且与远程实际路径一致。

## 2. 计划任务

- **创建任务**（只需做一次；若 .bat 或参数变更，可覆盖创建）：
  ```cmd
  schtasks /create /tn "MonouAgent_win_agent2" /tr "C:\Users\用户名\monoU\start-win_agent2.bat" /sc once /st 23:59 /sd 2030/01/01 /f
  ```
  `/sc once /st 23:59 /sd 01/01/2030` 表示「一次性、未来某刻」，仅用于占位；实际**不按时间自动跑**，只通过下面「运行」触发。

- **运行任务**（每次要启动/重启 agent 时）：
  ```cmd
  schtasks /run /tn "MonouAgent_win_agent2"
  ```
  任务会在后台执行 .bat，node 进程持续连接 Gateway，SSH 断开也不影响。

- 若希望避免同一台机上重复多个 agent 进程，可在运行任务前先结束已有 node：
  ```cmd
  taskkill /F /IM node.exe
  schtasks /run /tn "MonouAgent_win_agent2"
  ```

## 3. 本机一键脚本

技能目录下脚本 **scripts/start-remote-windows-agent.sh** 可完成：

- 在本机生成 .bat 并 scp 到远程；
- 在远程创建/覆盖计划任务；
- 可选：先 `taskkill /F /IM node.exe`，再 `schtasks /run`。

需传入环境变量：`REMOTE_USER`、`REMOTE_HOST`、`AGENT_ID`、`GATEWAY_URL`、`REMOTE_MONOU`（远程 monoU 的 Windows 绝对路径）；可选 `REMOTE_AGENT_DIR`（不设则用 `REMOTE_MONOU\agents\AGENT_ID`）。认证可用 `SSHPASS` 或 SSH 密钥。详见脚本内注释。
