/**
 * agent-from-dir 集成测试：从目录构建 session（pi coding-agent 即此类「agent from dir」）。
 * 使用 minimal-u fixture，通过 buildSessionFromU + skipEnsureAgentDir 加载 base_skill 的 tools.js，
 * 验证 mergedTools 与 executeTool（read/write/edit/bash）行为。
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildSessionFromU, loadSkillScriptTools, createSkillScriptExecutor } from "../src/index.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const FIXTURE_DIR = join(__dirname, "fixtures", "minimal-u");

describe("agent-from-dir (buildSessionFromU)", () => {
  it("builds session from minimal fixture with skipEnsureAgentDir", async () => {
    const session = await buildSessionFromU(FIXTURE_DIR, {
      agentDir: FIXTURE_DIR,
      skipEnsureAgentDir: true,
    });
    expect(session.agentDir).toBe(FIXTURE_DIR);
    const names = session.mergedTools.map((t) => t.name);
    expect(names).toContain("read");
    expect(names).toContain("write");
    expect(names).toContain("edit");
    expect(names).toContain("bash");
  });

  describe("session.executeTool (base_skill from fixture)", () => {
    let testDir: string;
    let session: Awaited<ReturnType<typeof buildSessionFromU>>;

    beforeEach(async () => {
      testDir = join(tmpdir(), `agent-from-dir-test-${Date.now()}`);
      mkdirSync(testDir, { recursive: true });
      session = await buildSessionFromU(FIXTURE_DIR, {
        agentDir: FIXTURE_DIR,
        skipEnsureAgentDir: true,
      });
    });

    afterEach(() => {
      rmSync(testDir, { recursive: true, force: true });
    });

    it("read: reads file content", async () => {
      const f = join(testDir, "f.txt");
      writeFileSync(f, "hello");
      const r = await session.executeTool("read", { path: f });
      expect(r.isError).toBeFalsy();
      expect(r.content).toBe("hello");
    });

    it("read: error for non-existent file", async () => {
      const r = await session.executeTool("read", { path: join(testDir, "nope.txt") });
      expect(r.isError).toBe(true);
      expect(r.content).toMatch(/not found|ENOENT/i);
    });

    it("write: creates file", async () => {
      const f = join(testDir, "new.txt");
      await session.executeTool("write", { path: f, content: "new content" });
      const r = await session.executeTool("read", { path: f });
      expect(r.content).toBe("new content");
    });

    it("edit: replaces text", async () => {
      const f = join(testDir, "e.txt");
      writeFileSync(f, "one two three", "utf-8");
      await session.executeTool("edit", { path: f, oldText: "two", newText: "2" });
      const r = await session.executeTool("read", { path: f });
      expect(r.content).toBe("one 2 three");
    });

    it("bash: runs command", async () => {
      const r = await session.executeTool("bash", { command: "echo ok" });
      expect(r.isError).toBeFalsy();
      expect(r.content.trim()).toBe("ok");
    });
  });
});

describe("loadSkillScriptTools (script discovery)", () => {
  it("excludes dirs with scripts/tools.js", () => {
    const { tools, entries } = loadSkillScriptTools([join(FIXTURE_DIR, "skills", "base_skill")], {
      excludeDirNames: ["base_skill"],
    });
    expect(entries).toHaveLength(0);
    expect(tools).toHaveLength(0);
  });

  it("returns empty when all dirs excluded or have tools.ts/js", () => {
    const { tools, entries } = loadSkillScriptTools([join(FIXTURE_DIR, "skills", "base_skill")]);
    expect(entries).toHaveLength(0);
    expect(tools).toHaveLength(0);
  });
});
