/**
 * Session 过期策略（freshness）：与 OpenClaw 对齐的 daily / idle 策略。
 * 配置来自环境变量：SESSION_RESET_MODE、SESSION_RESET_AT_HOUR、SESSION_IDLE_MINUTES。
 */

export type SessionResetMode = "daily" | "idle" | "none";

export type SessionResetPolicy = {
  mode: SessionResetMode;
  atHour: number;
  idleMinutes?: number;
};

export type SessionFreshness = {
  fresh: boolean;
  dailyResetAt?: number;
  idleExpiresAt?: number;
};

const DEFAULT_AT_HOUR = 4;
const DEFAULT_IDLE_MINUTES = 60;

function parseMode(): SessionResetMode {
  const v = process.env.SESSION_RESET_MODE?.trim().toLowerCase();
  if (v === "daily" || v === "idle") return v;
  if (v === "none" || v === "") return "none";
  return "none";
}

function parseAtHour(): number {
  const v = process.env.SESSION_RESET_AT_HOUR;
  if (v === undefined || v === "") return DEFAULT_AT_HOUR;
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_AT_HOUR;
  return Math.max(0, Math.min(23, Math.floor(n)));
}

function parseIdleMinutes(): number | undefined {
  const v = process.env.SESSION_IDLE_MINUTES;
  if (v === undefined || v === "") return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1) return undefined;
  return Math.floor(n);
}

/** 从环境变量读取 reset 策略；mode=none 表示永不过期 */
export function getSessionResetPolicy(): SessionResetPolicy {
  const mode = parseMode();
  const atHour = parseAtHour();
  const idleMinutes = parseIdleMinutes();
  return {
    mode,
    atHour,
    ...(idleMinutes != null && { idleMinutes }),
  };
}

/** 计算“今日” daily reset 的时间戳（上次 4:00 的 ms） */
export function resolveDailyResetAtMs(now: number, atHour: number): number {
  const d = new Date(now);
  d.setHours(atHour, 0, 0, 0);
  if (now < d.getTime()) d.setDate(d.getDate() - 1);
  return d.getTime();
}

/**
 * 判断当前 session 是否仍“新鲜”：未过 daily 或 idle 则 fresh=true。
 * policy.mode=none 时始终 fresh。
 */
export function evaluateSessionFreshness(params: {
  updatedAt: number;
  now: number;
  policy: SessionResetPolicy;
}): SessionFreshness {
  const { policy } = params;
  if (policy.mode === "none") {
    return { fresh: true };
  }
  const dailyResetAt =
    policy.mode === "daily"
      ? resolveDailyResetAtMs(params.now, policy.atHour)
      : undefined;
  const idleExpiresAt =
    policy.idleMinutes != null
      ? params.updatedAt + policy.idleMinutes * 60_000
      : undefined;
  const staleDaily = dailyResetAt != null && params.updatedAt < dailyResetAt;
  const staleIdle = idleExpiresAt != null && params.now > idleExpiresAt;
  return {
    fresh: !(staleDaily || staleIdle),
    dailyResetAt,
    idleExpiresAt,
  };
}

/** 默认 reset 触发命令（与 OpenClaw 一致） */
export const DEFAULT_RESET_TRIGGERS = ["/new", "/reset"];

/** 检查消息是否以某个 reset 触发词开头；返回触发词与剩余内容 */
export function parseResetTrigger(
  message: string,
  triggers: string[] = DEFAULT_RESET_TRIGGERS,
): { trigger: string; rest: string } | null {
  const trimmed = message.trim();
  const lower = trimmed.toLowerCase();
  for (const t of triggers) {
    const trigger = t.toLowerCase();
    if (lower === trigger) return { trigger: t, rest: "" };
    if (lower.startsWith(trigger + " ")) return { trigger: t, rest: trimmed.slice(trigger.length).trim() };
  }
  return null;
}
