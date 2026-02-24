/**
 * Frontmatter parser tests (ported from pi-coding-agent test/frontmatter.test.ts).
 * Tests parseFrontmatter for SKILL.md-style YAML blocks.
 */

import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "../src/frontmatter.js";

describe("parseFrontmatter", () => {
	it("parses keys and returns body", () => {
		const input = "---\nname: skill-name\ndescription: A desc\nfoo-bar: value\n---\n\nBody text";
		const { frontmatter, body } = parseFrontmatter<Record<string, string>>(input);
		expect(frontmatter.name).toBe("skill-name");
		expect(frontmatter.description).toBe("A desc");
		expect(frontmatter["foo-bar"]).toBe("value");
		expect(body).toBe("Body text");
	});

	it("normalizes newlines and handles CRLF", () => {
		const input = "---\r\nname: test\r\n---\r\nLine one\r\nLine two";
		const { body } = parseFrontmatter<Record<string, string>>(input);
		expect(body).toBe("Line one\nLine two");
	});

	it("parses boolean true/false", () => {
		const input = "---\ndisable-model-invocation: true\nfoo: false\n---\nBody";
		const { frontmatter } = parseFrontmatter<Record<string, boolean | string>>(input);
		expect(frontmatter["disable-model-invocation"]).toBe(true);
		expect(frontmatter.foo).toBe(false);
	});

	it("returns original content when frontmatter is missing", () => {
		const noFrontmatter = "Just text\nsecond line";
		const result = parseFrontmatter<Record<string, string>>(noFrontmatter);
		expect(result.frontmatter).toEqual({});
		expect(result.body).toBe("Just text\nsecond line");
	});

	it("returns body when frontmatter is unterminated", () => {
		const missingEnd = "---\nname: test\nBody without terminator";
		const result = parseFrontmatter<Record<string, string>>(missingEnd);
		expect(result.frontmatter).toEqual({});
		expect(result.body).toBe("---\nname: test\nBody without terminator");
	});

	it("parses multiline value with indentation", () => {
		const input = "---\ndescription:\n  Line one\n  Line two\n---\n\nBody";
		const { frontmatter, body } = parseFrontmatter<Record<string, string>>(input);
		expect(frontmatter.description).toBe("Line one\nLine two");
		expect(body).toBe("Body");
	});

	it("trims body after closing fence", () => {
		const input = "---\nkey: value\n---\n\nBody\n";
		const { body } = parseFrontmatter(input);
		expect(body).toBe("Body");
	});
});
