/**
 * Minimal base_skill tools for agent-from-dir integration test (plain ESM, no .ts).
 * Same contract as agent-template base_skill/scripts/tools.ts.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve } from "node:path";

export const tools = [
  { name: "read", description: "读取文件内容。", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
  { name: "bash", description: "执行 bash 命令。", parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } },
  { name: "edit", description: "对文件做精确编辑。", parameters: { type: "object", properties: { path: { type: "string" }, oldText: { type: "string" }, newText: { type: "string" } }, required: ["path", "oldText", "newText"] } },
  { name: "write", description: "创建或整文件覆盖写入。", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } },
];

function resolvePath(raw) {
  const p = (raw ?? "").trim();
  return p ? resolve(process.cwd(), p) : "";
}

export async function executeTool(name, args) {
  try {
    switch (name) {
      case "read": {
        const p = resolvePath(args?.path);
        if (!p) return { content: "path is required", isError: true };
        if (!existsSync(p)) return { content: `File not found: ${p}`, isError: true };
        return { content: readFileSync(p, "utf-8") };
      }
      case "bash": {
        const command = String(args?.command ?? "").trim();
        if (!command) return { content: "command is required", isError: true };
        const out = execSync(command, { encoding: "utf-8", maxBuffer: 4 * 1024 * 1024, cwd: process.cwd() });
        return { content: out || "(no output)" };
      }
      case "edit": {
        const p = resolvePath(args?.path);
        const oldText = String(args?.oldText ?? "");
        const newText = String(args?.newText ?? "");
        if (!p) return { content: "path is required", isError: true };
        if (!existsSync(p)) return { content: `File not found: ${p}`, isError: true };
        const content = readFileSync(p, "utf-8");
        if (!content.includes(oldText)) return { content: "oldText not found in file (must match exactly).", isError: true };
        writeFileSync(p, content.replace(oldText, newText), "utf-8");
        return { content: `Edited ${p}` };
      }
      case "write": {
        const p = resolvePath(args?.path);
        const content = String(args?.content ?? "");
        if (!p) return { content: "path is required", isError: true };
        writeFileSync(p, content, "utf-8");
        return { content: `Wrote ${p}` };
      }
      default:
        return { content: `Unknown tool: ${name}`, isError: true };
    }
  } catch (e) {
    return { content: e instanceof Error ? e.message : String(e), isError: true };
  }
}
