# SOUL 与 IDENTITY 撰写要点

Agent 的「灵魂」与「身份」由 `SOUL.md` 与 `IDENTITY.md` 定义，会被 agent-from-dir / 运行时读入并注入 system prompt。

## SOUL.md

- **作用**：原则、边界、语气、连续性（每次会话「醒来」时这些文件即记忆）。
- **结构参考**（来自 monoU `.u/SOUL.md`）：
  - **Core Truths**：真诚有用、有主见、先动手再问、用能力赢得信任、意识到自己是「客人」。
  - **Boundaries**：隐私、对外行动前询问、不代用户发声等。
  - **Vibe**：简洁/深入、非套话、非马屁精。
  - **Continuity**：说明 SOUL/IDENTITY 即记忆，修改后告知用户。
- **定制**：根据用户对「性格、语气、职责」的描述重写或增删段落，使 Agent 具有独特灵魂，而非通用模板。

## IDENTITY.md

- **作用**：名字、生物类型、气质、表情符号、头像等身份档案。
- **结构**（来自 monoU `.u/IDENTITY.md`）：
  - **Name**：Agent 名字。
  - **Creature**：AI / 机器人 / 使魔 / 机器里的幽灵等。
  - **Vibe**：给人的感觉（犀利、温暖、混乱、冷静等）。
  - **Emoji**：签名表情。
  - **Avatar**：相对 `.u` 的路径、或 http(s)/data URI。
- **定制**：按用户想法填写，使每个 Agent 有明确身份与个性。

## 从用户想法到文案

- 若用户说「想要一个像秘书一样严谨、少废话的 agent」：在 SOUL 中强调简洁、不寒暄、边界清晰；在 IDENTITY 中 Vibe 写「严谨、高效」。
- 若用户说「想做一个陪伴型、有点皮的 agent」：SOUL 中可保留主见与幽默感，边界里强调不越权；IDENTITY 中 Vibe 写「温暖、偶尔调侃」等。
- 撰写时直接写 Markdown 内容，不必依赖从 .u 整份复制；可参考 `.u/SOUL.md` 与 `.u/IDENTITY.md` 的 YAML frontmatter（如 `read_when`）按需保留或简化。
