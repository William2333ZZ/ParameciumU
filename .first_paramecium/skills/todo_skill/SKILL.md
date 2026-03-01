---
name: todo_skill
description: "In-session todo list for task breakdown and progress. Use when (1) breaking a complex task into steps — todowrite(items) with status pending; (2) starting an item — todowrite(merge: true, items: [{ id, status: in_progress }]); (3) marking done — todowrite(merge: true, items: [{ id, status: completed }]); (4) checking progress — todoread. Stored in .monou/todos.json per workspace. Aligns with OpenCode-style task management."
---

# Todo Skill

Maintain a todo list **in session** for task breakdown and progress. Stored under the workspace as `.monou/todos.json` (one list per workspace).

## When to use which tool

| Goal | Tool |
|------|------|
| Break a task into steps | **todowrite**(items) — each item: id, content, status (default pending). Omit merge or merge: false to replace the whole list. |
| Start working on one item | **todowrite**(merge: true, items: [{ id, content?, status: "in_progress" }]). |
| Mark one item done | **todowrite**(merge: true, items: [{ id, status: "completed" }]). |
| See current list / progress | **todoread**. |

## Guidelines

- **Plan first**: Use **todowrite** to add multiple items (pending), then work through them.
- **Update as you go**: Set the current item to in_progress when you start; set it to completed as soon as it’s done. Don’t batch updates — update one, then move to the next.
- **Check progress**: Use **todoread** before planning or resuming to see what’s left.

## Parameters

- **todowrite**
  - **items** (required): Array of `{ id, content, status? }`. status: `pending` | `in_progress` | `completed`; default `pending`.
  - **merge** (optional): If true, merge by id into the existing list (update status/content for given ids). If false or omitted, replace the entire list with items.
- **todoread**: No parameters; returns the current list.
