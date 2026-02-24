/**
 * Hooks 体系：发现 HOOK.md、解析 frontmatter、按事件派发 handler。
 * 发现顺序：workspace (agentDir/hooks) > managed (gatewayDataDir/hooks)。
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export type HookContext = {
  type: "command" | "session" | "gateway";
  action: string;
  sessionKey?: string;
  timestamp: Date;
  messages: string[];
  context: {
    sessionEntry?: unknown;
    sessionId?: string;
    workspaceDir?: string;
    agentId?: string;
    gatewayDataDir?: string;
    rootDir?: string;
  };
};

export type HookHandler = (event: HookContext) => void | Promise<void>;

export type HookEntry = {
  name: string;
  description?: string;
  events: string[];
  dir: string;
  handlerPath?: string;
};

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

function parseFrontmatter(md: string): Record<string, unknown> {
  const m = md.match(FRONTMATTER_RE);
  if (!m) return {};
  const block = m[1];
  const out: Record<string, unknown> = {};
  const lines = block.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const keyMatch = /^([a-zA-Z0-9_.]+):\s*(.*)$/.exec(line);
    if (keyMatch) {
      const key = keyMatch[1];
      let value: unknown = keyMatch[2].trim();
      if (value === "" && i + 1 < lines.length && /^\s+-\s+/.test(lines[i + 1])) {
        const arr: string[] = [];
        i++;
        while (i < lines.length && /^\s+-\s+/.test(lines[i])) {
          arr.push(lines[i].replace(/^\s+-\s+/, "").trim());
          i++;
        }
        value = arr;
        out[key] = value;
        continue;
      }
      if (typeof value === "string" && (value.startsWith("[") && value.endsWith("]"))) {
        try {
          value = value.slice(1, -1).split(",").map((s) => s.trim().replace(/^["']|["']$/g, ""));
        } catch (_) {}
      }
      out[key] = value;
    }
    i++;
  }
  return out;
}

function readEventsFromMeta(meta: Record<string, unknown>): string[] {
  const monou = meta.monou ?? meta.metadata as Record<string, unknown> | undefined;
  const ev = (monou && typeof monou === "object" && (monou as Record<string, unknown>).events) ?? meta.events;
  if (Array.isArray(ev)) return ev.filter((e): e is string => typeof e === "string");
  if (typeof ev === "string") return [ev];
  return [];
}

/** 扫描目录下所有含 HOOK.md 的子目录，解析为 HookEntry 列表；优先级 workspace > managed > bundled */
export function discoverHooks(opts: {
  workspaceHooksDir?: string;
  managedHooksDir?: string;
  bundledHooksDir?: string;
}): HookEntry[] {
  const seen = new Set<string>();
  const list: HookEntry[] = [];

  const scanDir = (dir: string) => {
    if (!dir || !fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const hookDir = path.join(dir, e.name);
      const hookMd = path.join(hookDir, "HOOK.md");
      if (!fs.existsSync(hookMd)) continue;
      const key = path.resolve(hookDir);
      if (seen.has(key)) continue;
      seen.add(key);
      const raw = fs.readFileSync(hookMd, "utf8");
      const meta = parseFrontmatter(raw);
      const name = (meta.name as string) ?? e.name;
      const events = readEventsFromMeta(meta);
      if (events.length === 0) continue;
      const handlerPath = ["handler.js", "handler.mjs", "index.js"].find((f) =>
        fs.existsSync(path.join(hookDir, f)),
      );
      list.push({
        name,
        description: typeof meta.description === "string" ? meta.description : undefined,
        events,
        dir: hookDir,
        handlerPath: handlerPath ? path.join(hookDir, handlerPath) : undefined,
      });
    }
  };

  if (opts.workspaceHooksDir) scanDir(opts.workspaceHooksDir);
  if (opts.managedHooksDir) scanDir(opts.managedHooksDir);
  if (opts.bundledHooksDir) scanDir(opts.bundledHooksDir);
  return list;
}

/** 派发事件：筛选出 events 包含该事件的 hooks，按顺序加载并执行 handler；单 hook 抛错只打日志不阻断 */
export async function emitHook(
  event: { type: HookContext["type"]; action: string; sessionKey?: string; context?: HookContext["context"] },
  hooks: HookEntry[],
  opts?: { rootDir?: string; gatewayDataDir?: string },
): Promise<void> {
  const eventKey = `${event.type}:${event.action}`;
  const ctx: HookContext = {
    type: event.type,
    action: event.action,
    sessionKey: event.sessionKey,
    timestamp: new Date(),
    messages: [],
    context: {
      ...event.context,
      rootDir: opts?.rootDir,
      gatewayDataDir: opts?.gatewayDataDir,
    },
  };
  const eligible = hooks.filter((h) => h.events.some((e) => e === eventKey || e === "*"));
  for (const hook of eligible) {
    if (!hook.handlerPath) continue;
    try {
      const mod = await import(pathToFileURL(hook.handlerPath).href);
      const handler: HookHandler = mod.default ?? mod.handler ?? mod;
      if (typeof handler === "function") await Promise.resolve(handler(ctx));
    } catch (err) {
      console.error(`[hooks] ${hook.name} (${eventKey}):`, (err as Error).message);
    }
  }
}
