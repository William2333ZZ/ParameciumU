import { useState, useCallback, useEffect } from "react";
import { getReadKey, getStoredLastRead, setStoredLastRead } from "./chat-read-storage";
import { ChatPanel } from "./panels/ChatPanel";
import { ChatWelcome } from "./panels/ChatWelcome";
import { ConversationListPanel } from "./panels/ConversationListPanel";
import { CreateGroupPanel } from "./panels/CreateGroupPanel";
import { ContactsPanel } from "./panels/ContactsPanel";
import { CapabilitiesPanel } from "./panels/CapabilitiesPanel";
import { SettingsPanel } from "./panels/SettingsPanel";
import { AgentStatusPanel } from "./panels/AgentStatusPanel";

export type TabId = "chat" | "contacts" | "capabilities" | "settings";

export type OpenChatPayload = { agentId: string; sessionKey?: string } | null;

type Props = {
  onDisconnect: () => void;
};

const NAV: { id: TabId; label: string }[] = [
  { id: "chat", label: "消息" },
  { id: "contacts", label: "Agent 通讯录" },
  { id: "capabilities", label: "能力通讯录" },
  { id: "settings", label: "设置" },
];

export function MainView({ onDisconnect }: Props) {
  const [tab, setTab] = useState<TabId>("chat");
  const [selectedConversation, setSelectedConversation] = useState<OpenChatPayload>(null);
  const [lastReadMap, setLastReadMap] = useState<Record<string, number>>(getStoredLastRead);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  /** 创建群聊后递增，让左侧会话列表重新拉取，新群出现在「群聊」里 */
  const [refreshListTrigger, setRefreshListTrigger] = useState(0);

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
          <span className="sidebar-title">ParameciumU</span>
        </div>
        <AgentStatusPanel />
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
                setTab("chat");
                setShowCreateGroup(true);
              }}
              refreshTrigger={refreshListTrigger}
            />
          </div>
          <main className="main-content main-content-chat">
            {showCreateGroup ? (
              <div className="main-content-panel main-content-panel--active chat-view-single">
                <CreateGroupPanel
                  onCreated={(leadAgentId, sessionKey) => {
                    setShowCreateGroup(false);
                    setRefreshListTrigger((t) => t + 1);
                    openChat(leadAgentId, sessionKey);
                  }}
                  onCancel={() => setShowCreateGroup(false)}
                />
              </div>
            ) : hasConversation ? (
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
                  onNewGroup={() => setShowCreateGroup(true)}
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
          <div className={`main-content-panel ${tab === "capabilities" ? "main-content-panel--active" : ""}`} aria-hidden={tab !== "capabilities"}>
            <CapabilitiesPanel />
          </div>
          <div className={`main-content-panel ${tab === "settings" ? "main-content-panel--active" : ""}`} aria-hidden={tab !== "settings"}>
            <SettingsPanel onDisconnect={onDisconnect} />
          </div>
        </main>
      )}
    </div>
  );
}
