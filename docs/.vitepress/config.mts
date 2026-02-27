import { defineConfig } from "vitepress";

export default defineConfig({
  title: "monoU 文档",
  description: "以「智能体标准化定义（基于文件夹）」为核心的主权智能体平台",
  base: "/ParameciumU/",
  srcDir: ".",
  outDir: "./.vitepress/dist",
  ignoreDeadLinks: true,
  themeConfig: {
    nav: [
      { text: "首页", link: "/" },
      { text: "快速开始", link: "/guide/getting-started" },
      { text: "架构", link: "/architecture/architecture" },
    ],
    sidebar: [
      {
        text: "入门",
        items: [
          { text: "文档首页", link: "/" },
          { text: "快速开始", link: "/guide/getting-started" },
        ],
      },
      {
        text: "架构与概念",
        items: [
          { text: "产品定位与能力规划", link: "/architecture/vision-and-roadmap" },
          { text: "整体架构", link: "/architecture/architecture" },
          { text: "Agent 目录约定", link: "/architecture/agent-directory" },
        ],
      },
      {
        text: "运行与协议",
        items: [
          { text: "Gateway 协议与实现", link: "/runtime/gateway" },
          { text: "应用说明 (apps)", link: "/runtime/apps" },
          { text: "模块说明 (packages)", link: "/runtime/packages" },
          { text: "Agent 运行机制", link: "/runtime/agent-running" },
          { text: "Heartbeat", link: "/runtime/heartbeat" },
        ],
      },
      {
        text: "Control UI",
        items: [
          { text: "界面与交互设计", link: "/control-ui/design" },
          { text: "节点能力接入", link: "/control-ui/node-capabilities" },
        ],
      },
      {
        text: "参考",
        items: [
          { text: "Code Engineer 与 code_skill", link: "/reference/code-skill-design" },
          { text: "Browser Node 设计", link: "/reference/browser-node-design" },
        ],
      },
      {
        text: "维护",
        items: [{ text: "部署文档站", link: "/deploy-docs-site" }],
      },
    ],
  },
});
