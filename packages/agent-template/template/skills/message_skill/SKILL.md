---
name: message_skill
description: Send a message to a connected channel (e.g. Feishu). Only available when agent runs with Gateway.
---

# Message Skill

Send a message to a specific channel/chat. Use when the user asks to "post to Feishu", "send a reminder to the group", or "push this to connector".

## Tools

| Tool | Use |
|------|-----|
| **send_message** | Send text to a connector chat (connectorId + chatId). Requires Gateway. |

## Guidelines

- You need connectorId and chatId (usually provided by the conversation context when the user is in a channel).
- If Gateway is not available, the tool will return an error.
