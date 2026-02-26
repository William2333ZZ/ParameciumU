import { useState, useCallback, useEffect } from "react";
import { getReadKey, getStoredLastRead, setStoredLastRead } from "./chat-read-storage";
import { ChatPanel } from "./panels/ChatPanel";
import { ChatWelcome } from "./panels/ChatWelcome";
import { ConversationListPanel } from "./panels/ConversationListPanel";
import { ContactsPanel } from "./panels/ContactsPanel";
import { SettingsPanel } from "./panels/SettingsPanel";

export type TabId = "chat" | "contacts" | "settings";

export type OpenChatPayload = { agentId: string; sessionKey?: string } | null;

type Props = {
  onDisconnect: () => void;
};

const NAV: { id: TabId; label: string }[] = [
  { id: "chat", label: "消息" },
  { id: "contacts", label: "通讯录" },
  { id: "settings", label: "设置" },
];

export function MainView({ onDisconnect }: Props) {
  const [tab, setTab] = useState<TabId>("chat");
  const [selectedConversation, setSelectedConversation] = useState<OpenChatPayload>(null);
  const [lastReadMap, setLastReadMap] = useState<Record<string, number>>(getStoredLastRead);

  const openChat = useCallback((agentId: string, sessionKey?: string) => {
    setSelectedConversation({ agentId, sessionKey });
    setTab("chat");
  }, []);

  useEffect(() => {
    if (!selectedConversation) return;
    const key = getReadKey(selectedConversation.agentId, selectedConversation.sessionKey);
    const now = Date.now();
    setLastReadMap((prev) => ({ ...prev, [key]: now }));
    setStoredLastRead(key, now);
  }, [selectedConversation?.agentId, selectedConversation?.sessionKey]);

  const showMessageView = tab === "chat";
  const hasConversation = selectedConversation != null;

  return (
    <div className="main-layout sidebar-layout slack-layout">
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

      {showMessageView ? (
        <>
          <div className="conversation-list-column">
            <ConversationListPanel
              selectedAgentId={selectedConversation?.agentId ?? null}
              selectedSessionKey={selectedConversation?.sessionKey ?? null}
              lastReadMap={lastReadMap}
              onOpenChat={openChat}
              onNewGroup={() => {
                setSelectedConversation({ agentId: ".u", sessionKey: `agent:.u:group-${Date.now()}` });
                setTab("chat");
              }}
            />
          </div>
          <main className="main-content main-content-chat">
            {hasConversation ? (
              <div className="main-content-panel main-content-panel--active chat-view-single">
                <ChatPanel
                  key={`${selectedConversation.agentId}-${selectedConversation.sessionKey ?? "main"}`}
                  initialAgentId={selectedConversation.agentId}
                  initialSessionKey={selectedConversation.sessionKey}
                  onOpenSession={openChat}
                />
              </div>
            ) : (
              <div className="main-content-panel main-content-panel--active chat-view-single">
                <ChatWelcome
                  onNewGroup={() => {
                    setSelectedConversation({ agentId: ".u", sessionKey: `agent:.u:group-${Date.now()}` });
                  }}
                />
              </div>
            )}
          </main>
        </>
      ) : (
        <main className="main-content main-content-full">
          <div className={`main-content-panel ${tab === "contacts" ? "main-content-panel--active" : ""}`} aria-hidden={tab !== "contacts"}>
            <ContactsPanel onOpenChat={openChat} />
          </div>
          <div className={`main-content-panel ${tab === "settings" ? "main-content-panel--active" : ""}`} aria-hidden={tab !== "settings"}>
            <SettingsPanel onDisconnect={onDisconnect} />
          </div>
        </main>
      )}
    </div>
  );
}
