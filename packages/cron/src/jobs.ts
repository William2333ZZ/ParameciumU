/**
 * Job CRUD and next-run computation. No openclaw dependency.
 */

import crypto from "node:crypto";
import type {
  CronJob,
  CronJobCreate,
  CronJobPatch,
  CronSchedule,
} from "./types.js";
import { computeNextRunAtMs } from "./schedule.js";
import { parseAbsoluteTimeMs } from "./parse.js";

function normalizeName(name: unknown): string {
  const s = typeof name === "string" ? name.trim() : "";
  if (s.length === 0) return "Untitled";
  return s;
}

function normalizeText(value: unknown): string | undefined {
  const s = typeof value === "string" ? value.trim() : "";
  return s.length > 0 ? s : undefined;
}

function resolveEveryAnchorMs(
  schedule: { everyMs: number; anchorMs?: number },
  fallbackMs: number,
): number {
  const raw = schedule.anchorMs;
  if (typeof raw === "number" && Number.isFinite(raw))
    return Math.max(0, Math.floor(raw));
  return Math.max(0, Math.floor(fallbackMs));
}

export function computeJobNextRunAtMs(
  job: CronJob,
  nowMs: number,
): number | undefined {
  if (!job.enabled) return undefined;
  if (job.schedule.kind === "at") {
    if (job.state.lastStatus === "ok" && job.state.lastRunAtMs != null)
      return undefined;
    const atMs = parseAbsoluteTimeMs(job.schedule.at);
    return atMs ?? undefined;
  }
  if (job.schedule.kind === "every") {
    const anchorMs = resolveEveryAnchorMs(
      job.schedule,
      job.createdAtMs ?? nowMs,
    );
    return computeNextRunAtMs({ ...job.schedule, anchorMs }, nowMs);
  }
  return computeNextRunAtMs(job.schedule, nowMs);
}

export function createJob(nowMs: number, input: CronJobCreate): CronJob {
  const id = crypto.randomUUID();
  const schedule: CronSchedule =
    input.schedule.kind === "every"
      ? {
          ...input.schedule,
          anchorMs: resolveEveryAnchorMs(input.schedule, nowMs),
        }
      : input.schedule;
  const job: CronJob = {
    id,
    name: normalizeName(input.name),
    description: normalizeText(input.description),
    enabled: input.enabled !== false,
    deleteAfterRun:
      typeof input.deleteAfterRun === "boolean"
        ? input.deleteAfterRun
        : schedule.kind === "at"
          ? true
          : undefined,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    schedule,
    payload: input.payload,
    state: { ...input.state },
    deliver: input.deliver,
  };
  job.state.nextRunAtMs = computeJobNextRunAtMs(job, nowMs);
  return job;
}

export function applyJobPatch(job: CronJob, patch: CronJobPatch): void {
  if (patch.name !== undefined) job.name = normalizeName(patch.name);
  if (patch.description !== undefined)
    job.description = normalizeText(patch.description);
  if (typeof patch.enabled === "boolean") job.enabled = patch.enabled;
  if (typeof patch.deleteAfterRun === "boolean")
    job.deleteAfterRun = patch.deleteAfterRun;
  if (patch.schedule) job.schedule = patch.schedule;
  if (patch.payload) {
    if (patch.payload.kind === "systemEvent" && "text" in patch.payload)
      job.payload = { kind: "systemEvent", text: patch.payload.text ?? "" };
    if (patch.payload.kind === "agentTurn" && "message" in patch.payload)
      job.payload = {
        kind: "agentTurn",
        message: patch.payload.message ?? "",
      };
  }
  if (patch.state) job.state = { ...job.state, ...patch.state };
  if (patch.deliver !== undefined) job.deliver = patch.deliver;
}

export function recomputeNextRuns(job: CronJob, nowMs: number): void {
  if (!job.enabled) {
    job.state.nextRunAtMs = undefined;
    return;
  }
  job.state.nextRunAtMs = computeJobNextRunAtMs(job, nowMs);
}

export function nextWakeAtMs(jobs: CronJob[], nowMs: number): number | null {
  const enabled = jobs.filter(
    (j) => j.enabled && typeof j.state.nextRunAtMs === "number",
  );
  if (enabled.length === 0) return null;
  return Math.min(
    ...enabled.map((j) => j.state.nextRunAtMs as number),
  );
}

export function findJob(jobs: CronJob[], id: string): CronJob | undefined {
  return jobs.find((j) => j.id === id);
}
