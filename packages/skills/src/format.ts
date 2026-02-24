import type { Skill } from "./types.js";

function escapeXml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

/**
 * Format skills for inclusion in a system prompt.
 * Agent Skills spec: https://agentskills.io/integrate-skills
 * Skills with disableModelInvocation=true are excluded (only invokable via explicit command).
 */
export function formatSkillsForPrompt(skills: Skill[]): string {
	const visible = skills.filter((s) => !s.disableModelInvocation);
	if (visible.length === 0) return "";

	const lines = [
		"\n\nThe following skills provide specialized instructions for specific tasks.",
		"Use the read tool to load a skill's file when the task matches its description.",
		"When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md) and use that absolute path in tool commands.",
		"",
		"<available_skills>",
	];
	for (const s of visible) {
		lines.push("  <skill>");
		lines.push(`    <name>${escapeXml(s.name)}</name>`);
		lines.push(`    <description>${escapeXml(s.description)}</description>`);
		lines.push(`    <location>${escapeXml(s.filePath)}</location>`);
		lines.push("  </skill>");
	}
	lines.push("</available_skills>");
	return lines.join("\n");
}
