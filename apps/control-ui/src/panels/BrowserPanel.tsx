/**
 * Browser 节点画面：用 CDP/Playwright 截图查看，不依赖 VNC。适用于自动化测试、Agent 执行浏览器任务（如发布文章）后查看结果。
 * 从 node.list 取 capability 含 browser 的节点，点击「获取截图」通过 node.invoke browser_screenshot 拉取并展示。
 */
import { useState, useEffect } from "react";
import { gatewayClient } from "../gateway-client";
import type { NodeItem } from "../types";

type NodeListPayload = { nodes?: NodeItem[] };

function isBrowserNode(n: NodeItem): boolean {
  return Array.isArray(n.capabilities) && n.capabilities.includes("browser");
}

type InvokeResult = { ok?: boolean; payload?: { screenshotBase64?: string; screenshotUrl?: string; url?: string }; error?: { message?: string } };

export function BrowserPanel() {
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [screenshot, setScreenshot] = useState<{ base64?: string; url?: string } | null>(null);
  const [screenshotLoading, setScreenshotLoading] = useState(false);
  const [screenshotErr, setScreenshotErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    gatewayClient
      .request<NodeListPayload>("node.list")
      .then((res) => {
        if (cancelled) return;
        if (!res.ok || !res.payload) {
          setErr(res.error?.message ?? "node.list 失败");
          setNodes([]);
          return;
        }
        const list = (res.payload as NodeListPayload).nodes ?? [];
        const browserNodes = list.filter(isBrowserNode);
        setNodes(browserNodes);
        if (browserNodes.length === 0) {
          setSelectedNodeId(null);
        } else {
          setSelectedNodeId((prev) =>
            prev && browserNodes.some((n) => n.nodeId === prev) ? prev : browserNodes[0].nodeId
          );
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setErr((e as Error).message);
          setNodes([]);
          setSelectedNodeId(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchScreenshot = async () => {
    if (!selectedNodeId) return;
    setScreenshotLoading(true);
    setScreenshotErr(null);
    setScreenshot(null);
    try {
      const res = await gatewayClient.request<{ id?: string; result?: InvokeResult }>("node.invoke", {
        nodeId: selectedNodeId,
        command: "browser_screenshot",
        params: {},
      });
      const result = res.payload?.result as InvokeResult | undefined;
      if (!res.ok || !result) {
        setScreenshotErr(res.error?.message ?? result?.error?.message ?? "调用失败");
        return;
      }
      if (result.ok && result.payload) {
        if (result.payload.screenshotBase64) {
          setScreenshot({ base64: result.payload.screenshotBase64, url: result.payload.url });
          return;
        }
        if (result.payload.screenshotUrl) {
          setScreenshot({ url: result.payload.screenshotUrl });
          setScreenshotErr(null);
          return;
        }
      }
      const opts = gatewayClient.getOptions();
      const base = opts?.url ? new URL(opts.url.replace(/^ws/, "http")).origin : "";
      if (base) {
        try {
          const r = await fetch(base + "/api/screenshots/pending/latest");
          if (r.ok) {
            setScreenshot({ url: "/api/screenshots/pending/latest" });
            setScreenshotErr(null);
            return;
          }
        } catch {
          // ignore
        }
      }
      setScreenshotErr(result?.error?.message ?? "无截图（请先执行 browser_fetch 等操作）");
    } catch (e) {
      setScreenshotErr((e as Error).message);
    } finally {
      setScreenshotLoading(false);
    }
  };

  return (
    <div className="browser-panel">
      <div className="browser-panel-header">
        <span className="browser-panel-title">Browser 节点画面（截图）</span>
        <span className="muted" style={{ fontSize: "0.75rem" }}>
          通过 CDP/Playwright 截图查看节点最近一次页面，无需 VNC；适合自动化测试与 Agent 浏览器任务后查看
        </span>
      </div>
      {loading && <p className="muted">加载节点列表…</p>}
      {err && <p className="muted" style={{ color: "var(--error)" }}>{err}</p>}
      {!loading && !err && nodes.length === 0 && (
        <p className="muted">当前无 Browser 节点（请启动 browser-node 并连接 Gateway）</p>
      )}
      {!loading && nodes.length > 0 && (
        <>
          <div className="browser-panel-toolbar">
            <label>
              <span className="muted" style={{ marginRight: "0.5rem" }}>节点：</span>
              <select
                value={selectedNodeId ?? ""}
                onChange={(e) => {
                  setSelectedNodeId(e.target.value || null);
                  setScreenshot(null);
                  setScreenshotErr(null);
                }}
                className="browser-panel-select"
              >
                {nodes.map((n) => (
                  <option key={n.nodeId} value={n.nodeId}>
                    {n.nodeId}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="browser-panel-btn"
              onClick={fetchScreenshot}
              disabled={screenshotLoading}
            >
              {screenshotLoading ? "获取中…" : "获取截图"}
            </button>
          </div>
          {screenshotErr && (
            <p className="muted" style={{ color: "var(--error)", marginTop: "0.5rem" }}>{screenshotErr}</p>
          )}
          <div className="browser-panel-iframe-wrap">
            {screenshot ? (
              <div className="browser-panel-screenshot-wrap">
                {screenshot.url && !screenshot.base64 && (
                  <p className="muted" style={{ fontSize: "0.75rem", marginBottom: "0.5rem" }}>最近一次 browser_fetch 截图（节点重启后从 Gateway 回退）</p>
                )}
                {screenshot.url && screenshot.base64 && (
                  <p className="muted" style={{ fontSize: "0.75rem", marginBottom: "0.5rem" }}>URL: {screenshot.url}</p>
                )}
                <img
                  src={
                    screenshot.base64
                      ? `data:image/png;base64,${screenshot.base64}`
                      : (() => {
                          const opts = gatewayClient.getOptions();
                          return opts?.url && screenshot.url
                            ? new URL(opts.url.replace(/^ws/, "http")).origin + screenshot.url
                            : "";
                        })()
                  }
                  alt="Browser screenshot"
                  className="browser-panel-screenshot"
                />
              </div>
            ) : (
              <p className="muted" style={{ padding: "2rem" }}>点击「获取截图」查看该节点最近一次页面截图</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
