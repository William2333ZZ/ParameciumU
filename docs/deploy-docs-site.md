---
title: "Deploy docs site"
summary: "Build docs/ with VitePress and deploy to GitHub Pages, Vercel, etc."
read_when:
  - Publishing docs as a static site
  - Configuring sidebar, theme, or CI deploy
---

# Deploy the docs as a static site

This doc describes how to use **VitePress** to build the Markdown under `docs/` into a static site and deploy to GitHub Pages, Vercel, Netlify, or your own server.

## Why VitePress

- Works with existing **Markdown + YAML frontmatter**; no change to doc structure.
- File/dir-based **sidebar**; you can mix `start/`, root, and other sections.
- Output is static HTML; deploy to any static host.
- Docs-only; ParameciumU app stack (React/Vite) is separate. Docusaurus is an alternative if you prefer it.

## Local quick start

### Install

From repo root:

```bash
npm install -D vitepress
```

(Or from `docs/` with its own package.json: `npm init -y` then `npm install -D vitepress` in docs.)

### Config

In `docs/.vitepress/config.mts` (example exists in repo):

- **title / description** — Site title and description.
- **themeConfig.sidebar** — Groups: Introduction, Concepts, Gateway (Hub), Automation, Runtime, Control UI, Reference, Maintenance; map to paths under `docs/`.
- **base** — e.g. `'/ParameciumU/'` for `https://YOUR_USERNAME.github.io/ParameciumU/`; use `'/'` for root domain.
- **ignoreDeadLinks** — Set `true` if docs contain example URLs (e.g. localhost) to avoid build link errors.

### Dev server

```bash
npx vitepress dev docs
```

Open the default URL (e.g. http://localhost:5173); edits to `docs/**/*.md` hot-reload.

### Build

```bash
npx vitepress build docs
```

Output in `docs/.vitepress/dist`; upload to any static host.

## Sidebar structure

Sidebar groups typically map to:

| Group | Paths |
|-------|--------|
| Getting started | README.md, start/getting-started.md |
| Concepts | concepts/architecture.md, agent-directory.md, vision-and-roadmap.md, paramecium-vision.md, ai-os-sketch.md |
| Gateway | gateway/index.md, protocol.md, multi-agent.md |
| Automation | automation/cron.md, automation/heartbeat.md |
| Runtime | runtime/apps.md, packages.md, agent-running.md, heartbeat.md |
| Control UI | control-ui/design.md, node-capabilities.md |
| Reference | reference/code-skill-design.md, browser-node-design.md |
| Maintenance | deploy-docs-site.md |

Config lives in `docs/.vitepress/config.mts`.

## Deploy options

### GitHub Pages

If the repo has **`.github/workflows/deploy-docs.yml`**, pushes to `main` that touch `docs/` can build and deploy to GitHub Pages.

**One-time setup:**

1. Repo **Settings → Pages**.
2. **Build and deployment** → **Source**: **GitHub Actions** (not “Deploy from a branch”).
3. Save. Pushing changes under `docs/` to `main` triggers deploy; or run the “Deploy Docs” workflow manually in Actions.

**URL:** `https://YOUR_USERNAME.github.io/ParameciumU/` (if repo name differs, set `base` in config to `'/YourRepoName/'`).

### Vercel / Netlify

- **Vercel** — Root = ParameciumU repo; Build: `npx vitepress build docs`; Output: `docs/.vitepress/dist`. Set Root Directory if package.json is not at repo root.
- **Netlify** — Build: `npx vitepress build docs`; Publish: `docs/.vitepress/dist`.

### Your own server

Upload contents of `docs/.vitepress/dist` to Nginx/Caddy static root; if using a subpath, set VitePress `base` accordingly.

## Optional: root scripts

In root `package.json` scripts:

```json
"docs:dev": "vitepress dev docs",
"docs:build": "vitepress build docs",
"docs:preview": "vitepress preview docs"
```

Then: `npm run docs:dev`, `npm run docs:build`, `npm run docs:preview`.

## Next steps

- [Getting started](start/getting-started.md)
