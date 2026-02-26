type Props = {
  onNewGroup?: () => void;
};

export function ChatWelcome({ onNewGroup }: Props) {
  return (
    <div className="chat-welcome">
      <div className="chat-welcome-inner">
        <h2 className="chat-welcome-title">消息</h2>
        <p className="chat-welcome-desc">
          从左侧选择一个智能体开始私聊，或进入群聊 / 全部会话继续对话。
        </p>
        {onNewGroup && (
          <button type="button" className="chat-welcome-btn" onClick={onNewGroup}>
            + 新建群聊
          </button>
        )}
      </div>
    </div>
  );
}
