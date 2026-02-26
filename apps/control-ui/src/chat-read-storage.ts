/** 纯前端已读：localStorage 存每个会话的上次已读时间 */

const STORAGE_KEY = "monou_chat_last_read";

export function getReadKey(agentId: string, sessionKey?: string): string {
  return sessionKey?.trim() || `agent:${agentId}:main`;
}

export function getStoredLastRead(): Record<string, number> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const o = JSON.parse(raw);
    return typeof o === "object" && o !== null ? o : {};
  } catch {
    return {};
  }
}

export function setStoredLastRead(readKey: string, ts: number): void {
  if (typeof localStorage === "undefined") return;
  try {
    const prev = getStoredLastRead();
    prev[readKey] = ts;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prev));
  } catch {
    // ignore
  }
}
