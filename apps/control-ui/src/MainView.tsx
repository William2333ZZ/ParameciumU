import { useState, useCallback } from "react";
import { ChatPanel } from "./panels/ChatPanel";
import { TopologyPanel } from "./panels/TopologyPanel";
import { CronPanel } from "./panels/CronPanel";
import { SessionsPanel } from "./panels/SessionsPanel";
import { SettingsPanel } from "./panels/SettingsPanel";

export type TabId =
  | "chat"
  | "topology"
  | "sessions"
  | "cron"
  | "settings";

export type OpenChatPayload = { agentId: string; sessionKey?: string };

type Props = {
  onDisconnect: () => void;
};

const NAV: { id: TabId; label: string }[] = [
  { id: "chat", label: "对话" },
  { id: "topology", label: "拓扑" },
  { id: "sessions", label: "会话" },
  { id: "cron", label: "Cron" },
  { id: "settings", label: "设置" },
];

export function MainView({ onDisconnect }: Props) {
  const [tab, setTab] = useState<TabId>("chat");
  const [openChatPayload, setOpenChatPayload] = useState<OpenChatPayload>({
    agentId: ".u",
    sessionKey: undefined,
  });

  const openChat = useCallback((agentId: string, sessionKey?: string) => {
    setOpenChatPayload({ agentId, sessionKey });
    setTab("chat");
  }, []);

  return (
    <div className="main-layout sidebar-layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <span className="status-dot" title="已连接" />
          <span className="sidebar-title">monoU</span>
        </div>
        <nav className="sidebar-nav">
          {NAV.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className={`nav-item ${tab === id ? "active" : ""}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <button
            type="button"
            className="nav-item disconnect-btn"
            onClick={onDisconnect}
          >
            断开
          </button>
        </div>
      </aside>
      <main className="main-content">
        {/* 对话页常挂载，仅用 CSS 隐藏，避免切 tab 后会话/消息状态丢失（对齐 OpenClaw） */}
        <div className={`main-content-panel ${tab === "chat" ? "main-content-panel--active" : ""}`} aria-hidden={tab !== "chat"}>
          <ChatPanel
            key={openChatPayload.agentId}
            initialAgentId={openChatPayload.agentId}
            initialSessionKey={openChatPayload.sessionKey}
            onOpenSession={openChat}
          />
        </div>
        <div className={`main-content-panel ${tab === "topology" ? "main-content-panel--active" : ""}`} aria-hidden={tab !== "topology"}>
          <TopologyPanel isActive={tab === "topology"} onOpenChat={openChat} />
        </div>
        <div className={`main-content-panel ${tab === "sessions" ? "main-content-panel--active" : ""}`} aria-hidden={tab !== "sessions"}>
          <SessionsPanel onOpenSession={openChat} />
        </div>
        <div className={`main-content-panel ${tab === "cron" ? "main-content-panel--active" : ""}`} aria-hidden={tab !== "cron"}>
          <CronPanel />
        </div>
        <div className={`main-content-panel ${tab === "settings" ? "main-content-panel--active" : ""}`} aria-hidden={tab !== "settings"}>
          <SettingsPanel onDisconnect={onDisconnect} />
        </div>
      </main>
    </div>
  );
}
