---
name: command-logger
description: 在 Gateway 启动时写一条审计日志（示例 hook）
events:
  - gateway:startup
metadata:
  monou:
    emoji: "📋"
---

command-logger 为内置示例：收到 `gateway:startup` 时向 `.gateway/hooks/command-logger.log` 追加一行时间戳与事件信息。
