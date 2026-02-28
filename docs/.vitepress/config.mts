import { defineConfig } from "vitepress";

export default defineConfig({
  title: "ParameciumU 文档",
  description: "以「智能体标准化定义（基于文件夹）」为核心的主权智能体平台；你是一只草履虫，可吸收营养进化、可复制繁殖。",
  base: "/ParameciumU/",
  srcDir: ".",
  outDir: "./.vitepress/dist",
  ignoreDeadLinks: true,
  themeConfig: {
    nav: [
      { text: "首页", link: "/" },
      { text: "快速开始", link: "/start/getting-started" },
      { text: "架构", link: "/concepts/architecture" },
      { text: "自动化", link: "/automation/cron" },
    ],
    sidebar: [
      {
        text: "入门",
        items: [
          { text: "文档首页", link: "/" },
          { text: "快速开始", link: "/start/getting-started" },
        ],
      },
      {
        text: "产品使用",
        items: [
          { text: "使用指南", link: "/start/getting-started" },
          { text: "应用说明 (apps)", link: "/runtime/apps" },
        ],
      },
      {
        text: "设计",
        items: [
          { text: "产品叙事与命名愿景", link: "/concepts/paramecium-vision" },
          { text: "产品定位与能力规划", link: "/concepts/vision-and-roadmap" },
          { text: "整体架构", link: "/concepts/architecture" },
          { text: "Agent 目录约定", link: "/concepts/agent-directory" },
          { text: "Gateway 概述", link: "/gateway/index" },
          { text: "Gateway 协议与实现", link: "/gateway/protocol" },
          { text: "定时任务（Cron）", link: "/automation/cron" },
          { text: "Heartbeat", link: "/automation/heartbeat" },
          { text: "Control UI 设计", link: "/control-ui/design" },
          { text: "节点能力接入", link: "/control-ui/node-capabilities" },
          { text: "Code Engineer 与 code_skill", link: "/reference/code-skill-design" },
          { text: "Browser Node 设计", link: "/reference/browser-node-design" },
        ],
      },
      {
        text: "运行",
        items: [
          { text: "模块说明 (packages)", link: "/runtime/packages" },
          { text: "Agent 运行机制", link: "/runtime/agent-running" },
        ],
      },
      {
        text: "维护",
        items: [{ text: "部署文档站", link: "/deploy-docs-site" }],
      },
    ],
  },
});
