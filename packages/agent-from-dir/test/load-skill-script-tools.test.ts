/**
 * loadSkillScriptTools / createSkillScriptExecutor 测试（对应 pi 的脚本技能发现与执行）。
 * 验证：仅含单脚本 .sh 的 skill 目录被识别为 1 个 tool；description 来自 SKILL.md；执行器能跑脚本。
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSkillScriptExecutor, loadSkillScriptTools } from "../src/index.js";

describe("loadSkillScriptTools", () => {
	let skillDir: string;

	beforeEach(() => {
		skillDir = join(tmpdir(), `script-skill-${Date.now()}`);
		mkdirSync(join(skillDir, "scripts"), { recursive: true });
	});

	afterEach(() => {
		rmSync(skillDir, { recursive: true, force: true });
	});

	it("discovers one tool when scripts/ has single .sh and no tools.js/ts", () => {
		const mySkillDir = join(skillDir, "my_script_skill");
		mkdirSync(join(mySkillDir, "scripts"), { recursive: true });
		writeFileSync(join(mySkillDir, "SKILL.md"), "---\nname: my-script-skill\ndescription: Echoes the path.\n---\n");
		writeFileSync(join(mySkillDir, "scripts", "run.sh"), '#!/usr/bin/env bash\necho "$1"\n');

		const { tools, entries } = loadSkillScriptTools([mySkillDir], { excludeDirNames: [] });

		expect(tools).toHaveLength(1);
		expect(tools[0].name).toBe("my_script_skill");
		expect(tools[0].description).toContain("Echoes the path");
		expect(entries).toHaveLength(1);
		expect(entries[0].scriptPath).toContain("run.sh");
	});

	it("skips dir when scripts/tools.ts exists (module skill)", () => {
		writeFileSync(join(skillDir, "SKILL.md"), "---\nname: has-module\ndescription: Has module.\n---\n");
		writeFileSync(join(skillDir, "scripts", "tools.ts"), "export const tools = [];\n");

		const { tools, entries } = loadSkillScriptTools([skillDir], { excludeDirNames: [] });

		expect(tools).toHaveLength(0);
		expect(entries).toHaveLength(0);
	});

	it("excludes dir by excludeDirNames", () => {
		const baseDir = join(skillDir, "base_skill");
		mkdirSync(join(baseDir, "scripts"), { recursive: true });
		writeFileSync(join(baseDir, "SKILL.md"), "---\nname: base_skill\ndescription: X\n---\n");
		writeFileSync(join(baseDir, "scripts", "only.sh"), "echo x\n");

		const { tools, entries } = loadSkillScriptTools([baseDir], {
			excludeDirNames: ["base_skill"],
		});

		expect(tools).toHaveLength(0);
		expect(entries).toHaveLength(0);
	});
});

describe("createSkillScriptExecutor", () => {
	let skillDir: string;

	beforeEach(() => {
		skillDir = join(tmpdir(), `exec-skill-${Date.now()}`, "echo_skill");
		mkdirSync(join(skillDir, "scripts"), { recursive: true });
		writeFileSync(join(skillDir, "SKILL.md"), "---\nname: echo-skill\ndescription: Echo.\n---\n");
		writeFileSync(join(skillDir, "scripts", "echo.sh"), "#!/usr/bin/env bash\necho ok\n");
	});

	afterEach(() => {
		try {
			rmSync(join(skillDir, ".."), { recursive: true, force: true });
		} catch {
			// ignore
		}
	});

	it("executes script and returns stdout", async () => {
		const { entries } = loadSkillScriptTools([skillDir], { excludeDirNames: [] });
		const execute = createSkillScriptExecutor(entries);

		const r = await execute("echo_skill", { path: "" });

		expect(r.isError).toBeFalsy();
		expect(r.content.trim()).toBe("ok");
	});

	it("returns error for unknown tool name", async () => {
		const { entries } = loadSkillScriptTools([skillDir], { excludeDirNames: [] });
		const execute = createSkillScriptExecutor(entries);

		const r = await execute("unknown_tool", { path: "x" });

		expect(r.isError).toBe(true);
		expect(r.content).toContain("Unknown script tool");
	});
});
