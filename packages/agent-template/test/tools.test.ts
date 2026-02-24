/**
 * 使用 base_skill 的 tools + executeTool 做执行测试（与 pi coding-agent tools.test 同思路）。
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executeTool, tools } from "../template/skills/base_skill/scripts/tools";

describe("base_skill tools (read, write, edit, bash)", () => {
	let testDir: string;

	beforeEach(() => {
		testDir = join(tmpdir(), `base-skill-tools-test-${Date.now()}`);
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	describe("tools definition", () => {
		it("exports read, bash, edit, write", () => {
			const names = tools.map((t) => t.name).sort();
			expect(names).toEqual(["bash", "edit", "read", "write"]);
		});
	});

	describe("read", () => {
		it("reads file content", async () => {
			const f = join(testDir, "test.txt");
			const content = "Hello, world!\nLine 2";
			writeFileSync(f, content);
			const r = await executeTool("read", { path: f });
			expect(r.isError).toBeFalsy();
			expect(r.content).toBe(content);
		});

		it("returns error for non-existent file", async () => {
			const r = await executeTool("read", { path: join(testDir, "nonexistent.txt") });
			expect(r.isError).toBe(true);
			expect(r.content).toMatch(/not found|ENOENT/i);
		});

		it("returns error when path is missing", async () => {
			const r = await executeTool("read", {});
			expect(r.isError).toBe(true);
			expect(r.content).toContain("path");
		});
	});

	describe("write", () => {
		it("creates file and writes content", async () => {
			const f = join(testDir, "new.txt");
			const content = "new file content";
			const r = await executeTool("write", { path: f, content });
			expect(r.isError).toBeFalsy();
			expect(r.content).toMatch(/Wrote|bytes/i);
			const r2 = await executeTool("read", { path: f });
			expect(r2.content).toBe(content);
		});

		it("overwrites existing file", async () => {
			const f = join(testDir, "overwrite.txt");
			writeFileSync(f, "old");
			const r = await executeTool("write", { path: f, content: "new" });
			expect(r.isError).toBeFalsy();
			const r2 = await executeTool("read", { path: f });
			expect(r2.content).toBe("new");
		});
	});

	describe("edit", () => {
		it("replaces oldText with newText", async () => {
			const f = join(testDir, "edit.txt");
			writeFileSync(f, "one two three", "utf-8");
			const r = await executeTool("edit", {
				path: f,
				oldText: "two",
				newText: "2",
			});
			expect(r.isError).toBeFalsy();
			expect(r.content).toMatch(/Edited/i);
			const r2 = await executeTool("read", { path: f });
			expect(r2.content).toBe("one 2 three");
		});

		it("returns error when oldText not found", async () => {
			const f = join(testDir, "edit.txt");
			writeFileSync(f, "only this", "utf-8");
			const r = await executeTool("edit", {
				path: f,
				oldText: "missing",
				newText: "x",
			});
			expect(r.isError).toBe(true);
			expect(r.content).toMatch(/not found|match/i);
		});
	});

	describe("bash", () => {
		it("runs command and returns output", async () => {
			const r = await executeTool("bash", { command: "echo hello" });
			expect(r.isError).toBeFalsy();
			expect(r.content.trim()).toBe("hello");
		});

		it("returns error when command is empty", async () => {
			const r = await executeTool("bash", { command: "" });
			expect(r.isError).toBe(true);
			expect(r.content).toContain("command");
		});
	});
});
