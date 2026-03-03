/**
 * Doc Export Skill：将解决方案正文导出为规范 Word 文档。
 * 当用户说「输出word文档」「导出Word」时调用 generate_word_document。
 */

import type { AgentTool } from "@monou/agent-core";
import { writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDir =
  typeof (import.meta as { url?: string }).url === "string"
    ? dirname(fileURLToPath((import.meta as { url: string }).url))
    : dirname(process.argv[1] ?? ".");

const GENERATE_DOCX_SCRIPT = join(scriptDir, "generate-docx.mjs");
/** solution_agent 根目录（绝对路径），用于 cwd 以解析 node_modules/docx */
const SOLUTION_AGENT_ROOT = resolve(scriptDir, "..", "..");

export const tools: AgentTool[] = [
  {
    name: "generate_word_document",
    description:
      "将解决方案正文生成为规范 Word 文档（.docx）。用户说「输出word文档」「导出Word」「生成Word」时调用。需要传入当前方案正文 content、客户名称 clientName，可选 date（YYYYMMDD）和 outputDir。返回生成文件的绝对路径。",
    parameters: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "完整解决方案正文（建议 Markdown，含 # / ## / ### 标题），与六章结构一致",
        },
        clientName: {
          type: "string",
          description: "客户名称，用于文件名与封面",
        },
        date: {
          type: "string",
          description: "日期，格式 YYYYMMDD；不传则使用当前日期",
        },
        outputDir: {
          type: "string",
          description: "输出目录绝对路径；不传则使用当前工作目录",
        },
      },
      required: ["content", "clientName"],
    },
  },
];

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: string; isError?: boolean }> {
  if (name !== "generate_word_document") {
    return { content: `Unknown tool: ${name}`, isError: true };
  }

  const content = String(args?.content ?? "").trim();
  const clientName = String(args?.clientName ?? "").trim() || "客户";
  const dateArg = args?.date != null ? String(args.date).trim() : "";
  const outputDirArg = args?.outputDir != null ? String(args.outputDir).trim() : "";

  if (!content) {
    return { content: "content 不能为空", isError: true };
  }

  if (!existsSync(GENERATE_DOCX_SCRIPT)) {
    return {
      content: `生成脚本不存在: ${GENERATE_DOCX_SCRIPT}。请确保 doc_export_skill/scripts/generate-docx.mjs 存在。`,
      isError: true,
    };
  }

  const tmpDir = mkdtempSync(join(tmpdir(), "solution-doc-"));
  const contentPath = join(tmpDir, "content.md");
  writeFileSync(contentPath, content, "utf-8");

  try {
    const argv = [GENERATE_DOCX_SCRIPT, contentPath, clientName];
    if (dateArg) argv.push(dateArg);
    argv.push(outputDirArg || process.cwd());
    const result = spawnSync(process.execPath, argv, {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
      cwd: SOLUTION_AGENT_ROOT,
    });
    const out = result.stdout?.trim() ?? "";
    if (result.status !== 0) {
      const err = result.stderr?.trim() ?? result.error?.message ?? "未知错误";
      const hint =
        /Cannot find module ['"]docx['"]|MODULE_NOT_FOUND.*docx/i.test(err)
          ? ` 请确保在 solution_agent 目录下执行过 npm install（安装 docx 依赖）。`
          : "";
      return { content: `生成 Word 失败: ${err}${hint}`, isError: true };
    }
    const outPath = out.split("\n")[0]?.trim();
    if (outPath && existsSync(outPath)) {
      return {
        content: `Word 文档已生成：${outPath}\n\n请使用该路径下载或打开文件。`,
      };
    }
    return { content: out?.trim() || "已执行，但未得到输出路径。", isError: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { content: `生成 Word 失败: ${msg}`, isError: true };
  }
}
