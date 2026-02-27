---
title: "部署文档站"
summary: "用 VitePress 将 docs 构建为静态站点并部署到 GitHub Pages、Vercel 等"
read_when:
  - 需要把文档发布为网页时
  - 配置侧栏、主题或 CI 部署时
---

# 将文档部署成网页

本文档说明如何用 **VitePress** 将 `docs/` 下的 Markdown 构建为静态文档站，并部署到 GitHub Pages、Vercel、Netlify 等。

## 一、为什么选 VitePress

- 与现有 **Markdown + YAML frontmatter** 完全兼容，无需改文档结构。
- 支持基于文件/目录的 **sidebar**，和 `start/`、根目录混排。
- 构建产物为静态 HTML，可部署到任意静态托管。
- 与 monoU 主技术栈（React/Vite）无关，仅文档站使用 Vue；若更熟悉 Docusaurus 也可用其替代，步骤类似。

## 二、本地快速启动

### 2.1 安装依赖

在 monorepo 根目录：

```bash
npm install -D vitepress
```

（若希望文档站独立仓库或子目录单独 package.json，可在 `docs/` 下 `npm init -y` 后在该目录执行 `npm install -D vitepress`。）

### 2.2 配置文件

在 `docs/.vitepress/config.mts` 中放置配置（本仓库已提供示例），主要项：

- **title / description**：站点标题与描述。
- **themeConfig.sidebar**：按「入门 / 架构与概念 / Gateway / 应用 / 设计参考」分组，对应 `docs/` 下文件。
- **base**：若部署到 `https://xxx.github.io/monoU/` 则设为 `'/monoU/'`；根域名则 `'/'`。
- **ignoreDeadLinks**：文档中若含示例 URL（如 `http://localhost:5173`），可设 `true` 避免构建时报死链错误。

### 2.3 启动开发服务器

```bash
npx vitepress dev docs
```

浏览器打开默认 `http://localhost:5173`，修改 `docs/**/*.md` 会热更新。

### 2.4 构建静态站

```bash
npx vitepress build docs
```

产物在 `docs/.vitepress/dist`，可上传到任意静态托管。

## 三、目录与侧栏结构

当前 `docs/` 结构：

| 侧栏分组     | 路径 |
|--------------|------|
| 入门         | `README.md`（首页）, `guide/getting-started.md` |
| 架构与概念   | `architecture/vision-and-roadmap.md`, `architecture.md`, `agent-directory.md` |
| 运行与协议   | `runtime/gateway.md`, `apps.md`, `packages.md`, `agent-running.md`, `heartbeat.md` |
| Control UI   | `control-ui/design.md`, `node-capabilities.md` |
| 参考         | `reference/code-skill-design.md`, `browser-node-design.md` |
| 维护         | `deploy-docs-site.md` |

侧栏配置见 `docs/.vitepress/config.mts`。

## 四、部署方式

### 4.1 GitHub Pages（推荐）

本仓库已包含 **`.github/workflows/deploy-docs.yml`**：推送到 `main` 且改动涉及 `docs/` 时会自动构建并部署到 GitHub Pages。

**你只需做一次**：

1. 打开仓库 **Settings → Pages**。
2. 在 **Build and deployment** 里，**Source** 选 **GitHub Actions**（不要选 Deploy from a branch）。
3. 保存后，推送包含 `docs/` 的改动到 `main` 会自动部署；或在 **Actions** 页打开 “Deploy Docs”，点 **Run workflow** 手动触发一次。

**访问地址**：`https://<你的 GitHub 用户名>.github.io/ParameciumU/`  
（若仓库名不同，需把 `docs/.vitepress/config.mts` 里的 `base` 改成 `'/你的仓库名/'`。）

### 4.2 Vercel / Netlify

- **Vercel**：根目录选 monoU 仓库，Build 命令填 `npx vitepress build docs`，输出目录填 `docs/.vitepress/dist`；若根目录无 package.json 需在「Root Directory」选到包含 package.json 的目录。
- **Netlify**：类似，Build command: `npx vitepress build docs`，Publish directory: `docs/.vitepress/dist`。

### 4.3 自建服务器

将 `docs/.vitepress/dist` 内容上传到 Nginx / Caddy 等静态根目录即可；若放在子路径，记得设置 VitePress 的 `base`。

## 五、可选：根目录脚本

在根目录 `package.json` 的 `scripts` 中可增加：

```json
"docs:dev": "vitepress dev docs",
"docs:build": "vitepress build docs",
"docs:preview": "vitepress preview docs"
```

之后执行 `npm run docs:dev` / `npm run docs:build` 即可。

## 下一步

- 快速开始：[guide/getting-started](./guide/getting-started.md)
