---
name: todo_skill
description: 会话内待办列表。复杂任务先拆成 todowrite，执行中用 todoread 查看、用 todowrite 更新状态（in_progress/completed），与 OpenCode 任务管理一致。
---

# Todo Skill

在会话内维护待办列表，用于任务拆解与进度跟踪。

## Tools

| Tool | Use |
|------|-----|
| **todowrite** | 写入或更新待办。可全量替换（默认）或按 id 合并更新；status 为 pending / in_progress / completed。 |
| **todoread** | 读取当前待办列表。规划或执行前先 todoread 确认进度。 |

## Guidelines

- 复杂任务先调用 **todowrite** 拆成多条待办（id、content、status: pending），再逐项执行。
- 开始做某一项时用 **todowrite**（merge: true）把该项设为 in_progress；做完立刻设为 completed。
- 不要攒一批再勾：完成一项就更新一项，再继续下一项。
- 需要看当前进度时用 **todoread**。
