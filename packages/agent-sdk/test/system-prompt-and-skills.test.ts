/**
 * System prompt and skills integration tests (ported from pi-coding-agent
 * system-prompt.test.ts and sdk-skills.test.ts). Tests createAgent with
 * systemPrompt and skillDirs: system message should contain both.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createAgent } from "../src/agent.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const validSkillDir = join(__dirname, "../../skills/test/fixtures/skills/valid-skill");

function getSystemMessageText(state: {
	messages: { role: string; content: { type: string; text?: string }[] }[];
}): string {
	const sys = state.messages.find((m) => m.role === "system");
	if (!sys?.content?.length) return "";
	return sys.content.map((c) => (c.type === "text" ? c.text : "")).join("");
}

describe("createAgent system prompt and skills", () => {
	it("prepends system message with systemPrompt only", () => {
		const { state } = createAgent({ systemPrompt: "You are helpful." });
		const text = getSystemMessageText(state);
		expect(text).toContain("You are helpful.");
		expect(state.messages.length).toBe(1);
		expect(state.messages[0].role).toBe("system");
	});

	it("prepends system message with skillDirs containing skill content", () => {
		const { state } = createAgent({ skillDirs: [validSkillDir] });
		const text = getSystemMessageText(state);
		expect(text).toContain("valid-skill");
		expect(text).toContain("A valid skill for testing purposes.");
		expect(state.messages[0].role).toBe("system");
	});

	it("combines systemPrompt and skillDirs in one system message", () => {
		const { state } = createAgent({
			systemPrompt: "You are helpful.",
			skillDirs: [validSkillDir],
		});
		const text = getSystemMessageText(state);
		expect(text).toContain("You are helpful.");
		expect(text).toContain("valid-skill");
		expect(text).toContain("A valid skill for testing purposes.");
	});

	it("has no system message when no systemPrompt and no skillDirs", () => {
		const { state } = createAgent({});
		expect(state.messages.length).toBe(0);
	});

	it("has empty initial messages when only tools provided", () => {
		const { state } = createAgent({ tools: [{ name: "read", description: "Read file" }] });
		expect(state.messages.length).toBe(0);
	});
});
