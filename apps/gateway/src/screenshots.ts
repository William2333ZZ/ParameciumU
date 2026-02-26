/**
 * 会话截图：把 content 中的 base64 图片落盘为文件，替换为可访问 URL；每会话最多保留 N 张，自动删最旧。
 */

import fs from "node:fs";
import path from "node:path";
import { createId } from "@monou/shared";

const MAX_SCREENSHOTS_PER_SESSION = 10;
const BASE64_REGEX = /!\[([^\]]*)\]\(data:image\/([^;]+);base64,([A-Za-z0-9+/=]+)\)/g;

function safeSessionKey(sessionKey: string): string {
  return sessionKey.replace(/[^a-zA-Z0-9.-]/g, "-");
}

/** 确保目录存在；若该会话下文件数 > max，按 mtime 删最旧的 */
function trimSessionScreenshots(dir: string, max: number): void {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir)
    .filter((f) => f.endsWith(".png") || f.endsWith(".jpg") || f.endsWith(".jpeg"))
    .map((f) => ({ name: f, mtime: fs.statSync(path.join(dir, f)).mtime.getTime() }))
    .sort((a, b) => a.mtime - b.mtime);
  for (let i = 0; i < files.length - max; i++) {
    try {
      fs.unlinkSync(path.join(dir, files[i]!.name));
    } catch {
      // ignore
    }
  }
}

/**
 * 从 content 中提取 data:image/...;base64,XXX，写入 screenshotsDir/<sessionKey>/<id>.png，
 * 并在 content 中替换为 ![...](/api/screenshots/<sessionKey>/<id>.png)。
 * 每会话最多保留 MAX_SCREENSHOTS_PER_SESSION 张。
 */
export function saveScreenshotsInContent(
  content: string,
  sessionKey: string,
  screenshotsDir: string,
): string {
  if (!content || typeof content !== "string") return content;
  const safe = safeSessionKey(sessionKey);
  const sessionDir = path.join(screenshotsDir, safe);
  let replaced = content;
  let match: RegExpExecArray | null;
  BASE64_REGEX.lastIndex = 0;
  while ((match = BASE64_REGEX.exec(content)) !== null) {
    const alt = match[1] ?? "截图";
    const ext = match[2]?.toLowerCase() === "jpeg" || match[2]?.toLowerCase() === "jpg" ? "jpg" : "png";
    const base64 = match[3];
    if (!base64) continue;
    const id = createId().slice(0, 12) + "." + ext;
    fs.mkdirSync(sessionDir, { recursive: true });
    try {
      fs.writeFileSync(path.join(sessionDir, id), Buffer.from(base64, "base64"));
    } catch {
      continue;
    }
    trimSessionScreenshots(sessionDir, MAX_SCREENSHOTS_PER_SESSION);
    const url = `/api/screenshots/${safe}/${id}`;
    replaced = replaced.replace(match[0], `![${alt}](${url})`);
  }
  return replaced;
}

/**
 * 将原始 base64 截图写入文件，返回 URL。用于 node.invoke.result 中把 payload.screenshotBase64 转为 screenshotUrl（无 sessionKey 时用 bucket 如 pending）。
 */
export function saveBase64ToScreenshotFile(
  base64: string,
  bucket: string,
  fileId: string,
  screenshotsDir: string,
): string {
  const safe = safeSessionKey(bucket);
  const safeId = path.basename(fileId).replace(/[^a-zA-Z0-9._-]/g, "-");
  const id = safeId.endsWith(".png") ? safeId : `${safeId}.png`;
  const dir = path.join(screenshotsDir, safe);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, id), Buffer.from(base64, "base64"));
  trimSessionScreenshots(dir, 20);
  return `/api/screenshots/${safe}/${id}`;
}

/** 解析 GET /api/screenshots/:sessionKey/:id，校验路径合法后返回文件路径，否则 null */
export function resolveScreenshotPath(
  screenshotsDir: string,
  sessionKey: string,
  id: string,
): string | null {
  const safe = safeSessionKey(sessionKey);
  const safeId = path.basename(id);
  if (safeId !== id || !/^[a-zA-Z0-9._-]+\.(png|jpg|jpeg)$/.test(safeId)) return null;
  const filePath = path.join(screenshotsDir, safe, safeId);
  if (!filePath.startsWith(path.resolve(screenshotsDir))) return null;
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
  return filePath;
}

/** pending 目录下最新一张截图的 URL（按 mtime），用于替换 attachment:screenshot.png 或 Control UI 回退展示 */
export function getLatestPendingScreenshotUrl(screenshotsDir: string): string | null {
  const dir = path.join(screenshotsDir, "pending");
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter((f) => f.endsWith(".png") || f.endsWith(".jpg") || f.endsWith(".jpeg"))
    .map((f) => ({ name: f, mtime: fs.statSync(path.join(dir, f)).mtime.getTime() }))
    .sort((a, b) => b.mtime - a.mtime);
  const latest = files[0];
  return latest ? `/api/screenshots/pending/${latest.name}` : null;
}

/** pending 目录下最新一张截图的本地文件路径，用于 GET /api/screenshots/pending/latest */
export function getLatestPendingScreenshotPath(screenshotsDir: string): string | null {
  const dir = path.join(screenshotsDir, "pending");
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter((f) => f.endsWith(".png") || f.endsWith(".jpg") || f.endsWith(".jpeg"))
    .map((f) => ({ name: f, mtime: fs.statSync(path.join(dir, f)).mtime.getTime() }))
    .sort((a, b) => b.mtime - a.mtime);
  const latest = files[0];
  return latest ? path.join(dir, latest.name) : null;
}

/** 将 content 中的 attachment:screenshot.png 等占位符替换为最近 pending 截图 URL（模型常输出该占位符） */
export function replaceAttachmentPlaceholderWithPendingUrl(
  content: string,
  screenshotsDir: string,
): string {
  if (!content || typeof content !== "string") return content;
  const url = getLatestPendingScreenshotUrl(screenshotsDir);
  if (!url) return content;
  return content.replace(/!\[([^\]]*)\]\(attachment:screenshot\.png\)/g, `![$1](${url})`);
}
