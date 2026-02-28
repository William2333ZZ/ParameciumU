import { defineConfig } from "vitepress";

export default defineConfig({
  title: "ParameciumU",
  description: "Sovereign agent platform: agent = standardized directory. Run Gateway and Agent on your machine; connect via Control UI, Feishu, or TUI.",
  base: "/ParameciumU/",
  srcDir: ".",
  outDir: "./.vitepress/dist",
  ignoreDeadLinks: true,
  themeConfig: {
    nav: [
      { text: "Docs", link: "/" },
      { text: "Getting started", link: "/start/getting-started" },
      { text: "Architecture", link: "/concepts/architecture" },
      { text: "Reference", link: "/reference/env" },
      { text: "中文", link: "/zh/" },
    ],
    sidebar: [
      {
        text: "Introduction",
        items: [
          { text: "Overview", link: "/" },
          { text: "Getting started", link: "/start/getting-started" },
        ],
      },
      {
        text: "Concepts",
        items: [
          { text: "Architecture", link: "/concepts/architecture" },
          { text: "Agent directory", link: "/concepts/agent-directory" },
          { text: "Gateway", link: "/concepts/gateway" },
          { text: "Cron", link: "/concepts/cron" },
        ],
      },
      {
        text: "Runtime",
        items: [{ text: "Apps", link: "/runtime/apps" }],
      },
      {
        text: "Reference",
        items: [
          { text: "Environment variables", link: "/reference/env" },
          { text: "Gateway protocol", link: "/reference/gateway-protocol" },
          { text: "Cron types", link: "/reference/cron-types" },
        ],
      },
    ],
    locales: {
      root: {
        label: "English",
        lang: "en",
      },
      zh: {
        label: "中文",
        lang: "zh-CN",
        link: "/zh/",
        nav: [
          { text: "文档", link: "/zh/" },
          { text: "快速开始", link: "/zh/start/getting-started" },
          { text: "架构", link: "/zh/concepts/architecture" },
          { text: "参考", link: "/zh/reference/env" },
          { text: "English", link: "/" },
        ],
        sidebar: [
          {
            text: "介绍",
            items: [
              { text: "概览", link: "/zh/" },
              { text: "快速开始", link: "/zh/start/getting-started" },
            ],
          },
          {
            text: "概念",
            items: [
              { text: "架构", link: "/zh/concepts/architecture" },
              { text: "智能体目录", link: "/zh/concepts/agent-directory" },
              { text: "Gateway", link: "/zh/concepts/gateway" },
              { text: "Cron", link: "/zh/concepts/cron" },
            ],
          },
          {
            text: "运行",
            items: [{ text: "应用", link: "/zh/runtime/apps" }],
          },
          {
            text: "参考",
            items: [
              { text: "环境变量", link: "/zh/reference/env" },
              { text: "Gateway 协议", link: "/zh/reference/gateway-protocol" },
              { text: "Cron 类型", link: "/zh/reference/cron-types" },
            ],
          },
        ],
      },
    },
  },
});
