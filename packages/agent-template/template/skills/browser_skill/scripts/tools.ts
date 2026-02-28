/**
 * Browser skill: discover Browser Node(s)、能力说明，以及 browser_fetch（用 WebKit 打开 URL 取正文+截图）。
 * 截图会以 Markdown 图片形式出现在 tool 结果中，Control UI 对话里可渲染为图像（图像模态）。
 */

import type { AgentTool } from "@monou/agent-core";

export type GatewayInvoke = (method: string, params: Record<string, unknown>) => Promise<unknown>;

/** 当前 Browser Node 协议支持的 command 列表（与 apps/browser-node 一致） */
const BROWSER_NODE_COMMANDS = [
  {
    name: "browser_fetch",
    description: "打开 URL 取正文+截图；或 currentPageOnly: true 仅截当前页（不跳转，用于弹窗）。",
    params: { url: "string（与 currentPageOnly 二选一）", currentPageOnly: "boolean（可选）", timeoutMs: "number（可选）", captureScreenshot: "boolean（可选）", waitAfterLoadMs: "number（可选）", waitUntil: "domcontentloaded|load|networkidle（可选）" },
  },
  {
    name: "browser_links",
    description: "获取当前页面所有链接（text + href），便于找到「我的主页」等链接再 goto 或点击。",
    params: {},
  },
  {
    name: "browser_click",
    description: "在当前页面点击元素；可选 waitAfterMs 点击后等待再截图返回。",
    params: { text: "string（可选）", selector: "string（可选）", waitAfterMs: "number（可选）" },
  },
  {
    name: "browser_fill",
    description: "在输入框/文本框内填入内容（会先清空再填）。按 CSS 选择器或按 placeholder 文本定位。",
    params: { text: "string（必填，要填入的内容）", selector: "string（可选）", placeholder: "string（可选）" },
  },
] as const;

export const tools: AgentTool[] = [
  {
    name: "browser_nodes",
    description:
      "列出具备 browser 能力的节点及其支持的命令（类似 MCP 发现）。返回 nodeId、deviceId、supportedCommands。无结果表示当前没有 Browser Node 连接。",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "browser_capabilities",
    description:
      "返回 Browser Node 支持的命令 schema（名称、描述、参数）。用于了解可对 browser 节点调用哪些 command（通过 node.invoke 时使用）。",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "browser_fetch",
    description:
      "用 Browser 节点打开 URL 取正文+截图；或传 currentPageOnly: true 仅对当前页截图取正文（不跳转），用于弹窗/模态框出现后的截图。需要至少一个 Browser 节点在线。",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "要打开的完整 URL（与 currentPageOnly 二选一）" },
        currentPageOnly: { type: "boolean", description: "true 时不跳转，只对当前页截图+取正文（如点击「发私信」后截弹窗）" },
        nodeId: { type: "string", description: "Browser 节点 ID，不填则用第一个可用节点" },
        timeoutMs: { type: "number", description: "超时毫秒" },
        captureScreenshot: { type: "boolean", description: "是否附带截图，默认 true" },
        waitAfterLoadMs: { type: "number", description: "等待毫秒（打开 URL 后或 currentPageOnly 时弹窗出现后等一会再截）" },
      },
      required: [],
    },
  },
  {
    name: "browser_links",
    description:
      "获取当前页面所有链接（文本 + URL）。用于在已打开页面（如知乎首页）上找到「我的主页」「个人主页」等链接，再通过 browser_fetch 打开该 URL 或 browser_click 点击。",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "browser_click",
    description:
      "在当前页面点击元素。可按文本点击（如「我的主页」「发私信」）或按 CSS 选择器。传 waitAfterMs 可在点击/跳转后等待再截一张图返回，便于确认新页面。",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "要点击的链接/按钮的文本（包含即可）" },
        selector: { type: "string", description: "CSS 选择器，与 text 二选一" },
        waitAfterMs: { type: "number", description: "点击后等待毫秒再截图返回（如 2000），便于查看新页/弹窗" },
      },
      required: [],
    },
  },
  {
    name: "browser_fill",
    description:
      "在输入框/文本框内填入内容（会先清空再填）。用于搜索框、登录框等。按 CSS 选择器或按 placeholder 文本定位。",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "要填入的内容（必填，传空字符串可清空输入框）" },
        selector: { type: "string", description: "目标 input/textarea 的 CSS 选择器" },
        placeholder: { type: "string", description: "目标输入框的 placeholder 文本（与 selector 二选一）" },
      },
      required: ["text"],
    },
  },
];

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  gatewayInvoke?: GatewayInvoke,
): Promise<{ content: string; isError?: boolean }> {
  if (!gatewayInvoke) {
    return {
      content: "Browser 技能需要连接 Gateway（请通过 Gateway 启动 Agent）。",
      isError: true,
    };
  }
  try {
    if (name === "browser_nodes") {
      const result = (await gatewayInvoke("node.list", {})) as {
        nodes?: Array<{ nodeId?: string; deviceId?: string; capabilities?: string[]; agents?: unknown[] }>;
      };
      const nodes = result?.nodes ?? [];
      const browserNodes = nodes.filter(
        (n) => Array.isArray(n.capabilities) && n.capabilities.includes("browser"),
      );
      const withCommands = browserNodes.map((n) => ({
        nodeId: n.nodeId ?? n.deviceId,
        deviceId: n.deviceId,
        supportedCommands: BROWSER_NODE_COMMANDS.map((c) => c.name),
      }));
      const out = {
        nodes: withCommands,
        nodeIds: withCommands.map((n) => n.nodeId).filter(Boolean),
        message:
          withCommands.length > 0
            ? `发现 ${withCommands.length} 个 Browser 节点，支持命令：${BROWSER_NODE_COMMANDS.map((c) => c.name).join(", ")}。可通过 node.invoke(nodeId, command, params) 调用。`
            : "当前无 Browser Node 在线。请启动 browser-node（npm run browser-node）并连接本 Gateway。",
      };
      return { content: JSON.stringify(out, null, 2) };
    }
    if (name === "browser_capabilities") {
      const out = {
        commands: BROWSER_NODE_COMMANDS.map((c) => ({
          name: c.name,
          description: c.description,
          params: c.params,
        })),
        message:
          "对 browser 节点调用时使用 node.invoke(nodeId, command, params)，其中 command 为上述 name，params 为上述 params。",
      };
      return { content: JSON.stringify(out, null, 2) };
    }
    if (name === "browser_fetch") {
      const currentPageOnly = args?.currentPageOnly === true;
      const url = typeof args?.url === "string" ? args.url.trim() : "";
      if (!currentPageOnly && !url) return { content: "browser_fetch 需要 url 或 currentPageOnly: true。", isError: true };
      let nodeId = typeof args?.nodeId === "string" ? args.nodeId.trim() : "";
      if (!nodeId) {
        const listRes = (await gatewayInvoke("node.list", {})) as {
          nodes?: Array<{ nodeId?: string; capabilities?: string[] }>;
        };
        const browserNodes = (listRes?.nodes ?? []).filter(
          (n) => Array.isArray(n.capabilities) && n.capabilities.includes("browser"),
        );
        nodeId = browserNodes[0]?.nodeId ?? "";
      }
      if (!nodeId) {
        return {
          content: "当前无 Browser 节点在线，无法执行 browser_fetch。请先启动 browser-node 并连接 Gateway。",
          isError: true,
        };
      }
      let timeoutMs = typeof args?.timeoutMs === "number" && args.timeoutMs > 0 ? args.timeoutMs : undefined;
      if (timeoutMs == null && !currentPageOnly && /zhihu\.com|weibo\.com|login|signin/i.test(url)) timeoutMs = 45_000;
      const captureScreenshot = args?.captureScreenshot !== false;
      let waitAfterLoadMs = typeof args?.waitAfterLoadMs === "number" && args.waitAfterLoadMs >= 0 ? args.waitAfterLoadMs : undefined;
      if (currentPageOnly && waitAfterLoadMs == null) waitAfterLoadMs = 600;
      let waitUntil = args?.waitUntil as "domcontentloaded" | "load" | "networkidle" | undefined;
      const isZhihuList = !currentPageOnly && /zhihu\.com\/people\/[^/]+\/(followers|following)/i.test(url);
      if (!waitUntil && isZhihuList) waitUntil = "networkidle";
      if (waitAfterLoadMs == null && isZhihuList) waitAfterLoadMs = 4000;
      const invokeRes = (await gatewayInvoke("node.invoke", {
        nodeId,
        command: "browser_fetch",
        params: {
          ...(url && { url }),
          ...(currentPageOnly && { currentPageOnly: true }),
          timeoutMs,
          captureScreenshot,
          ...(waitAfterLoadMs != null && { waitAfterLoadMs }),
          ...(waitUntil && { waitUntil }),
        },
      })) as { result?: { ok?: boolean; payload?: { content?: string; screenshotBase64?: string; screenshotUrl?: string; url?: string }; error?: { message?: string } } } | undefined;
      const result = invokeRes?.result;
      if (!result?.ok || !result.payload) {
        const msg = result?.error?.message ?? "browser_fetch 调用失败";
        return { content: msg, isError: true };
      }
      const { content: text, screenshotBase64, screenshotUrl, url: pageUrl } = result.payload;
      let content = typeof text === "string" && text.length > 0 ? text : "（无正文内容）";
      if (pageUrl) content = `**URL:** ${pageUrl}\n\n${content}`;
      if (typeof screenshotUrl === "string" && screenshotUrl.length > 0) {
        content += "\n\n**页面截图：**\n\n![页面截图](" + screenshotUrl + ")";
      } else if (typeof screenshotBase64 === "string" && screenshotBase64.length > 0) {
        content += "\n\n**页面截图：**\n\n![页面截图](data:image/png;base64," + screenshotBase64 + ")";
      }
      return { content };
    }
    if (name === "browser_links") {
      let nodeId = typeof args?.nodeId === "string" ? args.nodeId.trim() : "";
      if (!nodeId) {
        const listRes = (await gatewayInvoke("node.list", {})) as {
          nodes?: Array<{ nodeId?: string; capabilities?: string[] }>;
        };
        const browserNodes = (listRes?.nodes ?? []).filter(
          (n) => Array.isArray(n.capabilities) && n.capabilities.includes("browser"),
        );
        nodeId = browserNodes[0]?.nodeId ?? "";
      }
      if (!nodeId) {
        return {
          content: "当前无 Browser 节点在线，无法执行 browser_links。",
          isError: true,
        };
      }
      const invokeRes = (await gatewayInvoke("node.invoke", {
        nodeId,
        command: "browser_links",
        params: {},
      })) as { result?: { ok?: boolean; payload?: { links?: Array<{ text: string; href: string }>; currentUrl?: string }; error?: { message?: string } } } | undefined;
      const result = invokeRes?.result;
      if (!result?.ok) {
        const msg = (result as { error?: { message?: string } })?.error?.message ?? "browser_links 调用失败";
        return { content: msg, isError: true };
      }
      const links = (result?.payload?.links ?? []) as Array<{ text: string; href: string }>;
      const currentUrl = (result?.payload as { currentUrl?: string })?.currentUrl ?? "";
      const lines = links.length
        ? links.map((l) => `- ${l.text || "(无文本)"} → ${l.href}`).join("\n")
        : "（当前页无链接）";
      const header = currentUrl ? `**当前页:** ${currentUrl}\n\n**链接（共 ${links.length} 条）：**\n\n` : `**当前页链接（共 ${links.length} 条）：**\n\n`;
      return { content: header + lines };
    }
    if (name === "browser_click") {
      const text = typeof args?.text === "string" ? args.text.trim() : "";
      const selector = typeof args?.selector === "string" ? args.selector.trim() : "";
      if (!text && !selector) {
        return { content: "browser_click 需要 text 或 selector 至少一个。", isError: true };
      }
      let nodeId = typeof args?.nodeId === "string" ? args.nodeId.trim() : "";
      if (!nodeId) {
        const listRes = (await gatewayInvoke("node.list", {})) as {
          nodes?: Array<{ nodeId?: string; capabilities?: string[] }>;
        };
        const browserNodes = (listRes?.nodes ?? []).filter(
          (n) => Array.isArray(n.capabilities) && n.capabilities.includes("browser"),
        );
        nodeId = browserNodes[0]?.nodeId ?? "";
      }
      if (!nodeId) {
        return {
          content: "当前无 Browser 节点在线，无法执行 browser_click。",
          isError: true,
        };
      }
      const waitAfterMs = typeof args?.waitAfterMs === "number" && args.waitAfterMs >= 0 ? Math.min(args.waitAfterMs, 60_000) : undefined;
      const invokeRes = (await gatewayInvoke("node.invoke", {
        nodeId,
        command: "browser_click",
        params: { ...(text ? { text } : { selector }), ...(waitAfterMs != null && { waitAfterMs }) },
      })) as { result?: { ok?: boolean; payload?: { url?: string; screenshotBase64?: string; screenshotUrl?: string }; error?: { message?: string } } } | undefined;
      const result = invokeRes?.result;
      if (!result?.ok) {
        const msg = (result as { error?: { message?: string } })?.error?.message ?? "browser_click 调用失败";
        return { content: msg, isError: true };
      }
      const url = (result?.payload as { url?: string })?.url;
      const screenshotUrl = (result?.payload as { screenshotUrl?: string })?.screenshotUrl;
      const screenshotBase64 = (result?.payload as { screenshotBase64?: string })?.screenshotBase64;
      let out = url ? `已点击，当前页 URL: ${url}` : "已点击。";
      if (screenshotUrl) out += "\n\n**点击后截图：**\n\n![截图](" + screenshotUrl + ")";
      else if (screenshotBase64) out += "\n\n**点击后截图：**\n\n![截图](data:image/png;base64," + screenshotBase64 + ")";
      return { content: out };
    }
    if (name === "browser_fill") {
      if (typeof args?.text !== "string") {
        return { content: "browser_fill 需要参数 text（要填入的内容）。", isError: true };
      }
      const selector = typeof args?.selector === "string" ? args.selector.trim() : "";
      const placeholder = typeof args?.placeholder === "string" ? args.placeholder.trim() : "";
      if (!selector && !placeholder) {
        return { content: "browser_fill 需要 selector 或 placeholder 至少一个以定位输入框。", isError: true };
      }
      let nodeId = typeof args?.nodeId === "string" ? args.nodeId.trim() : "";
      if (!nodeId) {
        const listRes = (await gatewayInvoke("node.list", {})) as {
          nodes?: Array<{ nodeId?: string; capabilities?: string[] }>;
        };
        const browserNodes = (listRes?.nodes ?? []).filter(
          (n) => Array.isArray(n.capabilities) && n.capabilities.includes("browser"),
        );
        nodeId = browserNodes[0]?.nodeId ?? "";
      }
      if (!nodeId) {
        return { content: "当前无 Browser 节点在线，无法执行 browser_fill。", isError: true };
      }
      const invokeRes = (await gatewayInvoke("node.invoke", {
        nodeId,
        command: "browser_fill",
        params: { text: args.text, ...(selector && { selector }), ...(placeholder && { placeholder }) },
      })) as { result?: { ok?: boolean; payload?: { url?: string }; error?: { message?: string } } } | undefined;
      const result = invokeRes?.result;
      if (!result?.ok) {
        const msg = (result as { error?: { message?: string } })?.error?.message ?? "browser_fill 调用失败";
        return { content: msg, isError: true };
      }
      const url = (result?.payload as { url?: string })?.url;
      return { content: url ? `已填入，当前页 URL: ${url}` : "已填入。" };
    }
    return { content: `Unknown tool: ${name}`, isError: true };
  } catch (e) {
    return { content: e instanceof Error ? e.message : String(e), isError: true };
  }
}
