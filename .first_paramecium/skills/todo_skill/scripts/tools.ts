/**
 * Todo skill: todowrite, todoread. In-session todo list for task breakdown and progress.
 * Stored at workspace .monou/todos.json (one list per workspace). OpenCode-style task management.
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
      "Write or update the todo list. Break complex tasks into items (pending), set current to in_progress, then completed when done. merge: true merges by id into existing list; otherwise replaces the whole list.",
    parameters: {
      type: "object",
      properties: {
        merge: {
          type: "boolean",
          description: "If true, merge items by id into existing list (update status/content). If false or omitted, replace entire list. Default false.",
        },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Unique id, e.g. 1, 2, or task-1" },
              content: { type: "string", description: "Todo description" },
              status: {
                type: "string",
                enum: ["pending", "in_progress", "completed"],
                description: "Status; default pending",
              },
            },
            required: ["id", "content"],
          },
          description: "List of todo items",
        },
      },
      required: ["items"],
    },
  },
  {
    name: "todoread",
    description: "Read the current todo list. Use before planning or resuming to see progress.",
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
