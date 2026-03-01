import { defineConfig } from "vitepress";

export default defineConfig({
  title: "ParameciumU Docs",
  description:
    "Sovereign agent platform: definition = folder; Hub routes, Agents and Nodes run. Connectors as nodes.",
  base: "/ParameciumU/",
  srcDir: ".",
  outDir: "./.vitepress/dist",
  ignoreDeadLinks: true,
  themeConfig: {
    nav: [
      { text: "Home", link: "/" },
      { text: "Getting started", link: "/start/getting-started" },
      { text: "Architecture", link: "/concepts/architecture" },
      { text: "Automation", link: "/automation/cron" },
    ],
    sidebar: [
      {
        text: "Introduction",
        items: [
          { text: "Home", link: "/" },
          { text: "Getting started", link: "/start/getting-started" },
        ],
      },
      {
        text: "Concepts",
        items: [
          { text: "Architecture", link: "/concepts/architecture" },
          { text: "Agent directory (Definition)", link: "/concepts/agent-directory" },
          { text: "Vision and roadmap", link: "/concepts/vision-and-roadmap" },
          { text: "Paramecium vision", link: "/concepts/paramecium-vision" },
          { text: "AI OS sketch", link: "/concepts/ai-os-sketch" },
        ],
      },
      {
        text: "Gateway (Hub)",
        items: [
          { text: "Overview", link: "/gateway/index" },
          { text: "Protocol", link: "/gateway/protocol" },
          { text: "Multi-agent", link: "/gateway/multi-agent" },
        ],
      },
      {
        text: "Automation",
        items: [
          { text: "Cron", link: "/automation/cron" },
          { text: "Heartbeat", link: "/automation/heartbeat" },
        ],
      },
      {
        text: "Runtime",
        items: [
          { text: "Apps", link: "/runtime/apps" },
          { text: "Packages", link: "/runtime/packages" },
          { text: "Agent running", link: "/runtime/agent-running" },
          { text: "Heartbeat", link: "/runtime/heartbeat" },
        ],
      },
      {
        text: "Control UI",
        items: [
          { text: "Design", link: "/control-ui/design" },
          { text: "Node capabilities", link: "/control-ui/node-capabilities" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "Code skill design", link: "/reference/code-skill-design" },
          { text: "Browser node design", link: "/reference/browser-node-design" },
        ],
      },
      {
        text: "Maintenance",
        items: [{ text: "Deploy docs site", link: "/deploy-docs-site" }],
      },
    ],
  },
});
