---
name: web_skill
description: Fetch URL content or search the web. Use web_fetch for a known URL; use web_search when you need to find current information.
---

# Web Skill

Tools for reading web pages and searching the web.

## Tools

| Tool | Use |
|------|-----|
| **web_fetch** | Fetch and return text content of a URL (HTML stripped). Use when the user gives a link or you need page content. |
| **web_search** | Search the web and return snippets/links. Requires SERPER_API_KEY or TAVILY_API_KEY in env. Use when you need up-to-date information. |

## Environment

- **web_search** 需要 `SERPER_API_KEY` 或 `TAVILY_API_KEY` 之一。
- 可在 **agent 目录** 下放 `.env` 文件配置（如 `.first_paramecium/.env`），启动 agent 时会自动加载，无需改项目根 .env。

## Guidelines

- Prefer **web_fetch** when you have a specific URL.
- For JS-rendered pages (SPA), use **browser_skill**'s **browser_fetch_js** (requires a Browser Node connected to Gateway).
- Use **web_search** for open-ended queries or when you don't have a URL.
- Respect rate limits; avoid excessive calls.
