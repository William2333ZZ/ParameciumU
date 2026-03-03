/**
 * 将解决方案正文（Markdown 格式）生成为规范 .docx 文件。
 * 用法: node generate-docx.mjs <contentFilePath> <clientName> [date] [outputDir]
 * 输出: 在 outputDir 下生成 解决方案_客户名称_日期.docx，并向 stdout 输出该文件绝对路径。
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
} from "docx";

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseContentToBlocks(text) {
  const lines = (text || "").split(/\r?\n/);
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith("### ")) {
      blocks.push({ type: "h3", text: trimmed.slice(4).trim() });
      i++;
    } else if (trimmed.startsWith("## ")) {
      blocks.push({ type: "h2", text: trimmed.slice(3).trim() });
      i++;
    } else if (trimmed.startsWith("# ")) {
      blocks.push({ type: "h1", text: trimmed.slice(2).trim() });
      i++;
    } else if (trimmed) {
      blocks.push({ type: "p", text: trimmed });
      i++;
    } else {
      i++;
    }
  }
  return blocks;
}

function buildDocElements(blocks) {
  const elements = [];
  for (const b of blocks) {
    if (b.type === "h1") {
      elements.push(
        new Paragraph({
          text: b.text,
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 280, after: 120 },
        })
      );
    } else if (b.type === "h2") {
      elements.push(
        new Paragraph({
          text: b.text,
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 240, after: 100 },
        })
      );
    } else if (b.type === "h3") {
      elements.push(
        new Paragraph({
          text: b.text,
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 200, after: 80 },
        })
      );
    } else {
      elements.push(
        new Paragraph({
          children: [new TextRun({ text: b.text, size: 22 })],
          spacing: { before: 100, after: 100 },
        })
      );
    }
  }
  return elements;
}

async function main() {
  const contentPath = process.argv[2];
  const clientName = process.argv[3] || "客户";
  const dateArg = process.argv[4];
  const outputDirArg = process.argv[5];

  const date =
    dateArg && /^\d{8}$/.test(dateArg)
      ? dateArg
      : new Date().toISOString().slice(0, 10).replace(/-/g, "");

  const outputDir = outputDirArg
    ? (isAbsolute(outputDirArg) ? outputDirArg : resolve(process.cwd(), outputDirArg))
    : process.cwd();
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  const contentFilePath = isAbsolute(contentPath) ? contentPath : resolve(process.cwd(), contentPath);
  if (!existsSync(contentFilePath)) {
    throw new Error(`内容文件不存在: ${contentFilePath}`);
  }
  const content = readFileSync(contentFilePath, "utf-8");
  const blocks = parseContentToBlocks(content);
  const bodyElements = buildDocElements(blocks);

  const coverElements = [
    new Paragraph({
      children: [
        new TextRun({
          text: "解决方案",
          bold: true,
          size: 48,
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { before: 2000, after: 400 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `客户名称：${clientName}`,
          size: 28,
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `日期：${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`,
          size: 28,
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 800 },
    }),
    new Paragraph({ children: [new TextRun("")] }),
  ];

  const doc = new Document({
    sections: [
      { properties: {}, children: coverElements },
      { properties: {}, children: bodyElements },
    ],
  });

  const fileName = `解决方案_${clientName}_${date}.docx`;
  const outPath = join(outputDir, fileName);
  const buffer = await Packer.toBuffer(doc);
  writeFileSync(outPath, buffer);
  console.log(outPath);
}

main().catch((err) => {
  const msg = err.message || String(err);
  const stack = err.stack ? `\n${err.stack}` : "";
  console.error(msg + stack);
  process.exit(1);
});
