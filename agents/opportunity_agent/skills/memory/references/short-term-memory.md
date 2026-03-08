# 短期记忆与多轮对话

## 短期记忆 = 会话内 state

在同一进程、同一会话中，**多轮对话的记忆**由 Agent 的 `state.messages` 提供：

- 每轮调用 `runAgentTurnWithTools(state, config, streamFn, userInput, executeTool)` 时，会先把当前用户输入追加到 state，再让模型生成回复并执行工具；返回的 **result.state** 已包含本轮的用户消息、助手回复和工具结果。
- 下一轮只要把 **上一轮返回的 state** 再传入，模型就能看到之前所有轮次的对话，这就是**短期/多轮记忆**，无需任何额外存储或工具。

## 在示例中的用法

- **runMultiTurn(session, ["第一句", "第二句", "第三句"])**：在同一进程内连续多轮；第二句、第三句时模型能看到前面所有轮。
- **runOneTurn**：只跑一轮，不保留 state；若每次用 `run.ts "用户输入"` 单独启动进程，则轮与轮之间没有短期记忆（每次都是新 state）。

若希望 CLI 也支持多轮，需要以**常驻进程 + 循环读入**的方式运行（例如 TUI `run-tui.ts`），并在循环中复用同一 `state`。

## 何时用到长期记忆（memory 工具）

- 用户问「**上次**我们决定……」「**我的**偏好是……」：若「上次」是另一次启动的会话，则需从 **memory_search** 在 MEMORY.md / memory/*.md 里查。
- 用户说「**记住**这次对话要点」：用 **write** 把摘要写入 memory/YYYY-MM-DD.md，下次启动后可用 memory_search 回忆。

总结：**多轮对话记忆 = state.messages（同一会话内已有）；跨会话的近期 = 主动写入 memory 文件 + memory_search**。
