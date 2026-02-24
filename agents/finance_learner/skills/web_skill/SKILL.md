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

## Guidelines

- Prefer **web_fetch** when you have a specific URL.
- Use **web_search** for open-ended queries or when you don't have a URL.
- Respect rate limits; avoid excessive calls.
