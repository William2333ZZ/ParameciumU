/**
 * 按 sessionKey 的队列状态与排水（collect 模式）。
 * 当某 session 已有 run 时新消息入队；run 结束后 debounce 再合并排水。
 */

export type QueueConfig = {
  mode: "collect" | "followup" | "steer";
  debounceMs: number;
  cap: number;
  drop: "old" | "new" | "summarize";
};

const DEFAULT_QUEUE_CONFIG: QueueConfig = {
  mode: "collect",
  debounceMs: 1000,
  cap: 20,
  drop: "summarize",
};

export type QueuedItem = { message: string; enqueuedAt: number };

export type SessionQueueState = {
  /** sessionKey -> 当前 runId */
  sessionActiveRun: Map<string, string>;
  /** runId -> sessionKey，用于 run 结束时反查 */
  runIdToSessionKey: Map<string, string>;
  /** sessionKey -> 待处理消息 */
  sessionQueue: Map<string, QueuedItem[]>;
  /** sessionKey -> debounce timer */
  debounceTimers: Map<string, ReturnType<typeof setTimeout>>;
  config: QueueConfig;
};

export function createSessionQueueState(config?: Partial<QueueConfig>): SessionQueueState {
  return {
    sessionActiveRun: new Map(),
    runIdToSessionKey: new Map(),
    sessionQueue: new Map(),
    debounceTimers: new Map(),
    config: { ...DEFAULT_QUEUE_CONFIG, ...config },
  };
}

export function getQueueConfig(state: SessionQueueState): QueueConfig {
  return state.config;
}

/** 该 session 是否正在跑一轮 */
export function isSessionActive(state: SessionQueueState, sessionKey: string): boolean {
  return state.sessionActiveRun.has(sessionKey);
}

/** 注册当前 run，返回是否成功（若已在跑则不应再调） */
export function setActiveRun(
  state: SessionQueueState,
  sessionKey: string,
  runId: string,
): void {
  state.sessionActiveRun.set(sessionKey, runId);
  state.runIdToSessionKey.set(runId, sessionKey);
}

/** run 结束时根据 runId 清除并返回 sessionKey */
export function clearActiveRunByRunId(
  state: SessionQueueState,
  runId: string,
): string | undefined {
  const sessionKey = state.runIdToSessionKey.get(runId);
  state.runIdToSessionKey.delete(runId);
  if (sessionKey) state.sessionActiveRun.delete(sessionKey);
  return sessionKey;
}

/** 入队；若已满按 drop 策略处理。返回 true 表示已入队（或合并后入队） */
export function enqueue(
  state: SessionQueueState,
  sessionKey: string,
  message: string,
): { queued: true; dropped?: number } {
  const list = state.sessionQueue.get(sessionKey) ?? [];
  const { cap, drop } = state.config;
  const item: QueuedItem = { message: message.trim() || "(无文本)", enqueuedAt: Date.now() };
  if (list.length >= cap) {
    if (drop === "old") {
      list.shift();
      list.push(item);
    } else if (drop === "new") {
      // 丢弃本条
      return { queued: true, dropped: 1 };
    } else {
      // summarize: 保留前几条，合并成一条摘要再 push
      const dropped = list.splice(0, list.length - Math.max(0, cap - 2));
      const summary =
        dropped.length > 0
          ? `[已合并 ${dropped.length} 条排队消息]\n${dropped.map((d) => d.message).join("\n")}`
          : "";
      if (summary) list.push({ message: summary, enqueuedAt: Date.now() });
      list.push(item);
    }
  } else {
    list.push(item);
  }
  state.sessionQueue.set(sessionKey, list);
  return { queued: true };
}

/** 取并清空该 session 的队列，合并为一条（collect） */
function drainQueue(state: SessionQueueState, sessionKey: string): string | null {
  const list = state.sessionQueue.get(sessionKey);
  state.sessionQueue.delete(sessionKey);
  state.debounceTimers.delete(sessionKey);
  if (!list || list.length === 0) return null;
  const merged = list.map((i) => i.message).join("\n\n");
  return merged;
}

/**
 * run 完成后调用：若该 session 队列非空，则 debounce 后执行 runTurn(merged)。
 * runTurn 应由调用方提供，即「用合并后的消息跑一轮 agent」的逻辑。
 */
export function onRunComplete(
  state: SessionQueueState,
  sessionKey: string,
  runTurn: (mergedMessage: string) => Promise<void>,
): void {
  const list = state.sessionQueue.get(sessionKey);
  if (!list || list.length === 0) return;
  const existing = state.debounceTimers.get(sessionKey);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    const merged = drainQueue(state, sessionKey);
    if (merged) runTurn(merged).catch((err) => console.error("[queue] drain run failed:", err));
  }, state.config.debounceMs);
  state.debounceTimers.set(sessionKey, timer);
}
