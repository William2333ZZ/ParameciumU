---
name: sessions_skill
description: List sessions, preview session info, or send a message to another session. Requires Gateway.
---

# Sessions Skill

Work with multiple sessions: list them, preview, or trigger a run in another session.

## Tools

| Tool | Use |
|------|-----|
| **sessions_list** | List all sessions (sessionKey, sessionId, updatedAt, displayName). |
| **sessions_preview** | Same as list but minimal fields for quick preview. |
| **sessions_send** | Send a message to a session by sessionKey (triggers agent run in that session). |

## Guidelines

- Use sessions_list when you need to see which sessions exist.
- Use sessions_send to "post to another session" or delegate work to another conversation.
- Requires Gateway to be available.
