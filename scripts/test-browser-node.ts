/**
 * 测试 Browser Node 与 browser_skill：启动 Gateway、Browser Node、Agent，验证 node.list 出现 browser 节点，并让 Agent 调用 browser_nodes / browser_capabilities。
 *
 * 运行前：npm run build，且 apps/browser-node 已 build，可选 npx playwright install webkit（若需测 browser_fetch 再装）
 * 运行：npx tsx scripts/test-browser-node.ts
 */

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer(() => {});
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = addr && typeof addr === "object" ? addr.port : 0;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

let passed = 0;
let failed = 0;
function ok(name: string) {
  passed++;
  console.log("  [OK]", name);
}
function fail(name: string, reason: string) {
  failed++;
  console.log("  [FAIL]", name, "-", reason);
}

async function run() {
  console.log("=== 测试 Browser Node 与 browser_skill ===\n");

  const { callGateway } = await import("@monou/gateway");
  const port = await findFreePort();
  const gwUrl = `ws://127.0.0.1:${port}`;

  const gatewayPath = path.join(ROOT, "apps", "gateway", "dist", "index.js");
  const agentPath = path.join(ROOT, "apps", "agent", "dist", "index.js");
  const browserNodePath = path.join(ROOT, "apps", "browser-node", "dist", "index.js");

  if (!fs.existsSync(gatewayPath)) {
    fail("构建", "缺少 apps/gateway/dist/index.js，请先 npm run build");
    process.exit(1);
  }
  if (!fs.existsSync(agentPath)) {
    fail("构建", "缺少 apps/agent/dist/index.js，请先 npm run build");
    process.exit(1);
  }
  if (!fs.existsSync(browserNodePath)) {
    fail("构建", "缺少 apps/browser-node/dist/index.js，请先 cd apps/browser-node && npm run build");
    process.exit(1);
  }
  ok("产物存在");

  const gatewayChild = spawn(process.execPath, [gatewayPath], {
    env: { ...process.env, GATEWAY_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
    cwd: ROOT,
  });
  gatewayChild.stderr?.on("data", (d) => process.stderr.write(d));
  gatewayChild.stdout?.on("data", (d) => process.stdout.write(d));
  await new Promise((r) => setTimeout(r, 1500));

  const health = await callGateway<{ ok?: boolean }>({ url: gwUrl, method: "health", timeoutMs: 5000 });
  if (!health?.ok) {
    fail("Gateway health", "未返回 ok");
    gatewayChild.kill();
    process.exit(1);
  }
  ok("Gateway 已启动");

  const browserNodeChild = spawn(process.execPath, [browserNodePath], {
    env: { ...process.env, GATEWAY_URL: gwUrl, GATEWAY_WS_URL: gwUrl, BROWSER_NODE_ID: "browser-1" },
    stdio: ["ignore", "pipe", "pipe"],
    cwd: ROOT,
  });
  browserNodeChild.stderr?.on("data", (d) => process.stderr.write(d));
  browserNodeChild.stdout?.on("data", (d) => process.stdout.write(d));
  await new Promise((r) => setTimeout(r, 1500));

  const nodeList = await callGateway<{ nodes?: Array<{ nodeId?: string; capabilities?: string[] }> }>({
    url: gwUrl,
    method: "node.list",
    timeoutMs: 5000,
  });
  const nodes = nodeList?.nodes ?? [];
  const browserNode = nodes.find((n) => Array.isArray(n.capabilities) && n.capabilities.includes("browser"));
  if (!browserNode) {
    fail("node.list", "未发现 capabilities 含 browser 的节点");
    gatewayChild.kill();
    browserNodeChild.kill();
    process.exit(1);
  }
  ok("node.list 发现 Browser 节点: " + (browserNode.nodeId ?? browserNode.capabilities));

  const agentDir = path.join(ROOT, ".first_paramecium");
  const browserSkillDest = path.join(agentDir, "skills", "browser_skill");
  const browserSkillSrc = path.join(ROOT, "packages", "agent-template", "template", "skills", "browser_skill");
  if (fs.existsSync(browserSkillSrc)) {
    fs.mkdirSync(path.dirname(browserSkillDest), { recursive: true });
    fs.cpSync(browserSkillSrc, browserSkillDest, { recursive: true, force: true });
    ok("已从模板同步 .first_paramecium/skills/browser_skill（含 browser_fetch）");
  }

  const hasBrowserSkill = fs.existsSync(path.join(ROOT, ".first_paramecium", "skills", "browser_skill", "SKILL.md"));
  if (!hasBrowserSkill) {
    console.log("  [SKIP] .first_paramecium 下无 browser_skill，仅测 node.list");
  } else {
    const { buildSessionFromU } = await import("@monou/agent-from-dir");
    const gatewayInvoke = (method: string, params: Record<string, unknown>) =>
      callGateway({
        url: gwUrl,
        method,
        params,
        timeoutMs: method === "node.invoke" ? 30_000 : 15_000,
      });
    const session = await buildSessionFromU(ROOT, { agentDir, gatewayInvoke });
    const hasBrowserTools = session.mergedTools.some((t) => t.name === "browser_nodes" || t.name === "browser_capabilities");
    const hasBrowserFetchTool = session.mergedTools.some((t) => t.name === "browser_fetch");
    if (!hasBrowserTools) {
      fail("browser_skill", "mergedTools 中无 browser_nodes / browser_capabilities");
    } else {
      ok("browser_skill 已加载（browser_nodes / browser_capabilities）");
    }
    if (hasBrowserFetchTool) {
      const fetchViaSkill = await session.executeTool("browser_fetch", { url: "https://example.com" });
      if (fetchViaSkill.isError) {
        fail("browser_fetch(skill)", fetchViaSkill.content);
      } else {
        ok("browser_fetch(skill) 返回 content");
        if (fetchViaSkill.content.includes("![页面截图](data:image/png;base64,")) {
          ok("browser_fetch(skill) 返回含 Markdown 图片，Control UI 可渲染为图像");
        }
      }
    } else {
      console.log("  [SKIP] .first_paramecium/skills/browser_skill 无 browser_fetch 工具（可覆盖复制 template 以测试）");
    }

    const nodesResult = await session.executeTool("browser_nodes", {});
    if (nodesResult.isError) {
      fail("browser_nodes", nodesResult.content);
    } else {
      const parsed = JSON.parse(nodesResult.content) as { nodes?: unknown[]; nodeIds?: string[] };
      const hasNodes = Array.isArray(parsed?.nodes) && parsed.nodes.length > 0 && parsed.nodeIds?.includes("browser-1");
      if (hasNodes) ok("browser_nodes 返回含 browser-1 的节点列表");
      else fail("browser_nodes", "返回中未含 browser-1 或 nodes 为空");
    }

    const capResult = await session.executeTool("browser_capabilities", {});
    if (capResult.isError) {
      fail("browser_capabilities", capResult.content);
    } else {
      const parsed = JSON.parse(capResult.content) as { commands?: Array<{ name?: string }> };
      const hasFetch = parsed?.commands?.some((c) => c.name === "browser_fetch");
      if (hasFetch) ok("browser_capabilities 返回 browser_fetch 命令");
      else fail("browser_capabilities", "返回中无 browser_fetch");
    }
  }

  // CDP/截图流程：browser_fetch 带截图 -> browser_screenshot 返回最近截图（不依赖 VNC）
  const invokeRes = await callGateway<{ result?: { ok?: boolean; payload?: { content?: string; screenshotBase64?: string }; error?: { message?: string } } }>({
    url: gwUrl,
    method: "node.invoke",
    params: { nodeId: "browser-1", command: "browser_fetch", params: { url: "https://example.com" } },
    timeoutMs: 25_000,
  });
  const fetchResult = invokeRes?.result;
  if (!fetchResult?.ok || !fetchResult.payload?.content) {
    fail("browser_fetch", fetchResult?.error?.message ?? "无 content");
  } else {
    ok("browser_fetch 返回 content");
    if (typeof fetchResult.payload.screenshotBase64 === "string" && fetchResult.payload.screenshotBase64.length > 0) {
      ok("browser_fetch 同时返回 screenshotBase64");
    }
  }

  const screenshotRes = await callGateway<{ result?: { ok?: boolean; payload?: { screenshotBase64?: string }; error?: { message?: string } } }>({
    url: gwUrl,
    method: "node.invoke",
    params: { nodeId: "browser-1", command: "browser_screenshot", params: {} },
    timeoutMs: 5000,
  });
  const screenResult = screenshotRes?.result;
  if (!screenResult?.ok || !screenResult.payload?.screenshotBase64) {
    fail("browser_screenshot", screenResult?.error?.message ?? "无 screenshotBase64");
  } else {
    ok("browser_screenshot 返回 screenshotBase64（CDP/截图路径可用，无需 VNC）");
  }

  browserNodeChild.kill();
  gatewayChild.kill();
  await new Promise((r) => setTimeout(r, 500));

  console.log("\n--- 结果:", passed, "passed,", failed, "failed ---");
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
