/**
 * 全流程测试：Gateway + Browser Node（Docker，Xvfb+VNC）+ Agent，访问知乎并可通过 noVNC 看界面。
 *
 * 1. 启动 Gateway（本机随机端口）
 * 2. 构建并运行 browser-node 容器（Xvfb + x11vnc + noVNC，有头模式），连接 Gateway
 * 3. 启动 Agent（.u）
 * 4. 调用 node.invoke browser_fetch 打开知乎
 * 5. 在 Control UI 的「浏览器」Tab 中查看当前浏览器窗口（VNC 通过 control-ui 代理，不单独用 6080）
 *
 * 运行: npx tsx scripts/test-browser-node-docker.ts
 * 前置: npm run build；Docker 已启动；首次请先构建镜像:
 *   docker build -t monou-browser-node -f apps/browser-node/Dockerfile apps/browser-node
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
  console.log("=== 全流程测试：Gateway + Browser Node (Docker Xvfb+VNC) + Agent，访问知乎 ===\n");

  const { callGateway } = await import("@monou/gateway");
  const port = await findFreePort();
  const gwUrl = `ws://127.0.0.1:${port}`;
  const gatewayHost = "host.docker.internal";

  const gatewayPath = path.join(ROOT, "apps", "gateway", "dist", "index.js");
  const agentPath = path.join(ROOT, "apps", "agent", "dist", "index.js");
  if (!fs.existsSync(gatewayPath) || !fs.existsSync(agentPath)) {
    fail("构建", "请先 npm run build");
    process.exit(1);
  }

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
    fail("Gateway", "health 失败");
    gatewayChild.kill();
    process.exit(1);
  }
  ok("Gateway 已启动");

  const gwUrlForContainer = `ws://${gatewayHost}:${port}`;
  const dockerArgs = [
    "run",
    "--rm",
    "--init",
    "-e",
    `GATEWAY_URL=${gwUrlForContainer}`,
    "-e",
    "GATEWAY_WS_URL=" + gwUrlForContainer,
    "-e",
    "BROWSER_NODE_ID=browser-1",
    "-e",
    "BROWSER_HEADED=1",
    "-p",
    "6080:6080",
    "-p",
    "5900:5900",
    "--add-host=host.docker.internal:host-gateway",
    "monou-browser-node",
  ];

  const dockerChild = spawn("docker", dockerArgs, {
    stdio: ["ignore", "pipe", "pipe"],
    cwd: ROOT,
  });
  dockerChild.stderr?.on("data", (d) => process.stderr.write(d));
  dockerChild.stdout?.on("data", (d) => process.stdout.write(d));
  await new Promise((r) => setTimeout(r, 8000));

  const nodeList = await callGateway<{ nodes?: Array<{ nodeId?: string; capabilities?: string[] }> }>({
    url: gwUrl,
    method: "node.list",
    timeoutMs: 10000,
  });
  const browserNode = nodeList?.nodes?.find(
    (n) => Array.isArray(n.capabilities) && n.capabilities.includes("browser"),
  );
  if (!browserNode) {
    fail("node.list", "未发现 browser 节点（可能容器未连上 Gateway，检查 GATEWAY_URL 与 host.docker.internal）");
  } else {
    ok("node.list 发现 Browser 节点");
  }

  const uChild = spawn(process.execPath, [agentPath], {
    env: { ...process.env, GATEWAY_URL: gwUrl, AGENT_ID: ".u", AGENT_DIR: path.join(ROOT, ".u") },
    stdio: ["ignore", "pipe", "pipe"],
    cwd: ROOT,
  });
  uChild.stderr?.on("data", (d) => process.stderr.write(d));
  uChild.stdout?.on("data", (d) => process.stdout.write(d));
  await new Promise((r) => setTimeout(r, 5000));

  const invokePayload = await callGateway<{
    result?: { ok?: boolean; payload?: { content?: string }; error?: { message?: string } };
  }>({
    url: gwUrl,
    method: "node.invoke",
    params: {
      nodeId: "browser-1",
      command: "browser_fetch",
      params: { url: "https://www.zhihu.com", timeoutMs: 20000 },
    },
    timeoutMs: 35000,
  });

  const result = invokePayload?.result;
  if (result?.ok) {
    ok("browser_fetch 知乎 成功");
    const content = result.payload?.content ?? "";
    if (content.includes("登录") || content.includes("登录") || content.length < 500) {
      console.log("  [INFO] 页面内容含「登录」或较短，可能需登录。请通过 noVNC 查看当前浏览器窗口。");
    }
  } else {
    const err = result?.error?.message ?? "unknown";
    fail("browser_fetch", err);
  }

  console.log("\n--- 查看界面 ---");
  console.log("  启动 Control UI（npm run dev - 在 apps/control-ui）并连接本机 Gateway；");
  console.log("  在 Control UI 侧边栏点击「浏览器」Tab 即可看到 Docker 内浏览器当前窗口（VNC 已与 control-ui 连上）。");
  console.log("  按 Ctrl+C 结束测试并停止容器。\n");

  uChild.kill();
  await new Promise((r) => setTimeout(r, 1000));

  console.log("--- 结果:", passed, "passed,", failed, "failed ---");
  dockerChild.kill("SIGTERM");
  gatewayChild.kill();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
