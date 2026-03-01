# Skill Library: choosing skills for a new agent

When creating a new agent, select only the skills it needs — do not copy the entire `.first_paramecium` directory wholesale.

## Required skills (agent-template defaults)

The following skills are available in `packages/agent-template/template/skills/` and `.first_paramecium/skills/`. An agent needs at least the first three to function:

| Skill | Purpose | Recommendation |
|-------|---------|----------------|
| base_skill | Core tools (read files, execute commands, etc.) | Required |
| memory | Read/write/search long-term memory | Required |
| cron | Scheduled tasks | Required |
| skill-creator | Create and update other skills | Optional |

## Optional skills

Any directory under `.first_paramecium/skills/` that contains a `SKILL.md` is a skill. Copy whichever ones the new agent needs into its `skills/` directory.

## How to copy skills

1. **Template-based**: copy `base_skill`, `memory`, `cron` (and optionally `skill-creator`) from `packages/agent-template/template/skills/` to `AGENT_DIR/skills/`.
2. **From `.first_paramecium`**: copy skills from `.first_paramecium/skills/` to `AGENT_DIR/skills/`.
3. Always copy the full skill directory — do not copy `SKILL.md` alone and leave out `scripts/` or `references/`, or tools and references will be missing.

## About this skill (agent-creator)

`agent-creator` is used by a running agent to create new agents. It lives in the orchestrating agent's `skills/` directory (e.g. `.first_paramecium/skills/`). You only need to copy it to a new agent if you want that agent to also be able to spawn sub-agents.
