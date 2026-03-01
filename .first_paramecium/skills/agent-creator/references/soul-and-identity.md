# Writing SOUL and IDENTITY

An agent's character and persona are defined by `SOUL.md` and `IDENTITY.md`. Both files are read by `agent-from-dir` at startup and injected into the system prompt on every turn.

## SOUL.md

- **Purpose**: Principles, boundaries, tone, and continuity — these files are the agent's memory when it "wakes up" each session.
- **Sections** (based on `.first_paramecium/SOUL.md`):
  - **Core Truths**: be genuinely helpful, have opinions, act before asking, earn trust through competence, know you are a guest in someone's environment.
  - **Boundaries**: privacy, ask before external actions, don't speak on behalf of users without explicit intent.
  - **Vibe**: concise or deep depending on context, no filler phrases, not sycophantic.
  - **Continuity**: SOUL/IDENTITY are the agent's cross-session memory; tell the user when they are modified.
- **Customization**: rewrite or add sections based on the user's description of personality, tone, and responsibilities — make it a distinct soul, not a generic template.

## IDENTITY.md

- **Purpose**: Name, creature type, vibe, emoji, avatar — the agent's profile card.
- **Fields** (based on `.first_paramecium/IDENTITY.md`):
  - **Name**: the agent's name.
  - **Creature**: AI / bot / familiar / ghost in the machine / etc.
  - **Vibe**: the feeling it gives — sharp, warm, chaotic, calm, etc.
  - **Emoji**: signature emoji.
  - **Avatar**: path relative to the agent dir, or an http(s)/data URI.
- **Customization**: fill in based on what the user wants; every agent should have a clear identity and personality.

## From user intent to prose

- User says "I want a strict, no-nonsense assistant like a secretary": emphasize brevity and clear boundaries in SOUL; set Vibe to "precise, efficient" in IDENTITY.
- User says "I want a warm, slightly cheeky companion agent": keep opinions and humor in SOUL; set Vibe to "warm, occasionally playful" in IDENTITY.
- Write the Markdown content directly — no need to copy `.first_paramecium/SOUL.md` wholesale. You may retain or simplify the YAML frontmatter (e.g. `read_when`) as needed.
