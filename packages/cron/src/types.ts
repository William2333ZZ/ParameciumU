/**
 * Cron job and store types. Compatible with common cron semantics (at / every / cron expr).
 * No dependency on openclaw.
 */

export type CronSchedule =
  | { kind: "at"; at: string }
  | { kind: "every"; everyMs: number; anchorMs?: number }
  | { kind: "cron"; expr: string; tz?: string };

export type CronPayload =
  | { kind: "systemEvent"; text: string }
  | { kind: "agentTurn"; message: string };

/** 定时任务跑完后主动推送到某 connector 的某会话（主动回复到 app） */
export type CronDeliver = {
  connectorId: string;
  chatId: string;
};

export type CronJobState = {
  nextRunAtMs?: number;
  lastRunAtMs?: number;
  lastStatus?: "ok" | "error" | "skipped";
  lastError?: string;
};

export type CronJob = {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  deleteAfterRun?: boolean;
  createdAtMs: number;
  updatedAtMs: number;
  schedule: CronSchedule;
  payload: CronPayload;
  state: CronJobState;
  /** 跑完后推送到该 connector 会话（仅当 payload.kind === "agentTurn" 时有效） */
  deliver?: CronDeliver;
};

export type CronStoreFile = {
  version: 1;
  jobs: CronJob[];
};

export type CronJobCreate = Omit<CronJob, "id" | "createdAtMs" | "updatedAtMs" | "state"> & {
  state?: Partial<CronJobState>;
  deliver?: CronDeliver;
};

export type CronJobPatch = Partial<
  Omit<CronJob, "id" | "createdAtMs" | "state" | "payload">
> & {
  payload?: Partial<CronPayload>;
  state?: Partial<CronJobState>;
  deliver?: CronDeliver;
};

export type CronStatus = {
  storePath: string;
  jobs: number;
  nextWakeAtMs: number | null;
};

export type CronRunResult =
  | { ok: true; ran: true }
  | { ok: true; ran: false; reason: "not-due" | "already-running" }
  | { ok: false; error: string };
