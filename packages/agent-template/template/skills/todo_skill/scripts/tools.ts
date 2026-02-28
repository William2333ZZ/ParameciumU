/**
 * Todo Skill：会话内待办 todowrite / todoread。与 OpenCode 任务管理对齐。
 * 存储于工作区 .monou/todos.json（按工作区一份列表）。
 */

import type { AgentTool } from "@monou/agent-core";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const FILENAME = ".monou/todos.json";

type TodoStatus = "pending" | "in_progress" | "completed";

interface TodoItem {
  id: string;
  content: string;
  status?: TodoStatus;
}

function getTodosPath(): string {
  return path.resolve(process.cwd(), FILENAME);
}

function loadTodos(): TodoItem[] {
  const p = getTodosPath();
  if (!existsSync(p)) return [];
  try {
    const raw = readFileSync(p, "utf-8");
    const data = JSON.parse(raw) as { items?: unknown[] };
    if (!Array.isArray(data?.items)) return [];
    return data.items.filter(
      (x): x is TodoItem =>
        x != null && typeof x === "object" && typeof (x as TodoItem).id === "string" && typeof (x as TodoItem).content === "string",
    );
  } catch {
    return [];
  }
}

function saveTodos(items: TodoItem[]): void {
  const p = getTodosPath();
  const dir = path.dirname(p);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(p, JSON.stringify({ items }, null, 2), "utf-8");
}

export const tools: AgentTool[] = [
  {
    name: "todowrite",
    description:
      "写入或更新待办列表。复杂任务先拆成多条待办再执行；执行中把当前项设为 in_progress，完成后设为 completed。merge 为 true 时按 id 合并更新，否则全量替换。",
    parameters: {
      type: "object",
      properties: {
        merge: {
          type: "boolean",
          description: "为 true 时按 id 合并到现有列表（更新 status/content），否则用本次 items 完全替换列表。默认 false。",
        },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "唯一 id，如 1、2 或 task-1" },
              content: { type: "string", description: "待办描述" },
              status: {
                type: "string",
                enum: ["pending", "in_progress", "completed"],
                description: "状态，默认 pending",
              },
            },
            required: ["id", "content"],
          },
          description: "待办项列表",
        },
      },
      required: ["items"],
    },
  },
  {
    name: "todoread",
    description: "读取当前待办列表。规划或执行前可先 todoread 确认进度。",
    parameters: { type: "object", properties: {} },
  },
];

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: string; isError?: boolean }> {
  try {
    if (name === "todowrite") {
      const raw = args.items;
      if (!Array.isArray(raw) || raw.length === 0) {
        return { content: "items (array, at least one) is required", isError: true };
      }
      const items: TodoItem[] = raw.map((x) => {
        const o = x as Record<string, unknown>;
        return {
          id: String(o?.id ?? ""),
          content: String(o?.content ?? ""),
          status: (o?.status as TodoStatus) || "pending",
        };
      });
      const merge = Boolean(args.merge);
      if (merge) {
        const current = loadTodos();
        const byId = new Map(current.map((t) => [t.id, { ...t }]));
        for (const it of items) {
          const existing = byId.get(it.id);
          byId.set(it.id, {
            id: it.id,
            content: it.content || (existing?.content ?? ""),
            status: it.status ?? existing?.status ?? "pending",
          });
        }
        saveTodos(Array.from(byId.values()));
      } else {
        saveTodos(items);
      }
      const list = loadTodos();
      const lines = list.map((t) => `- [${t.status}] ${t.id}: ${t.content}`);
      return { content: lines.length ? lines.join("\n") : "Todo list cleared." };
    }

    if (name === "todoread") {
      const list = loadTodos();
      if (list.length === 0) return { content: "No todos. Use todowrite to add." };
      const lines = list.map((t) => `- [${t.status ?? "pending"}] ${t.id}: ${t.content}`);
      return { content: lines.join("\n") };
    }

    return { content: `Unknown tool: ${name}`, isError: true };
  } catch (e) {
    return { content: e instanceof Error ? e.message : String(e), isError: true };
  }
}
