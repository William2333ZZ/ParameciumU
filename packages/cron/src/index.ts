/**
 * @monou/cron — standalone cron job store and schedule computation.
 * No openclaw dependency. Use from cron skill or any consumer.
 */

import { fileURLToPath } from "node:url";

export type {
  CronSchedule,
  CronPayload,
  CronDeliver,
  CronJobState,
  CronJob,
  CronStoreFile,
  CronJobCreate,
  CronJobPatch,
  CronStatus,
  CronRunResult,
} from "./types.js";
export { parseAbsoluteTimeMs } from "./parse.js";
export { computeNextRunAtMs } from "./schedule.js";
export { loadStore, saveStore } from "./store.js";
export {
  createJob,
  applyJobPatch,
  computeJobNextRunAtMs,
  recomputeNextRuns,
  nextWakeAtMs,
  findJob,
} from "./jobs.js";

import path from "node:path";
import type { CronJob, CronJobCreate, CronJobPatch, CronStoreFile } from "./types.js";
import { loadStore, saveStore } from "./store.js";
import {
  createJob,
  applyJobPatch,
  computeJobNextRunAtMs,
  recomputeNextRuns,
  nextWakeAtMs,
  findJob,
} from "./jobs.js";

/**
 * Resolve store path: CRON_STORE env or default under current project .u (./.u/cron/jobs.json).
 */
export function getDefaultStorePath(cwd: string = process.cwd()): string {
  const env = process.env.CRON_STORE?.trim();
  if (env) return path.resolve(env);
  return path.join(cwd, ".u", "cron", "jobs.json");
}

/**
 * 返回调度器 CLI 的绝对路径，供 skill 或脚本 spawn 常驻进程用。
 */
export function getSchedulerCliPath(): string {
  return path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "cli.js",
  );
}

/**
 * In-memory + file cron store. All methods are async and read/write from disk.
 */
export class CronStore {
  constructor(public readonly storePath: string) {}

  private async ensureStore(): Promise<CronStoreFile> {
    return loadStore(this.storePath);
  }

  async list(opts?: { includeDisabled?: boolean }): Promise<CronJob[]> {
    const store = await this.ensureStore();
    const jobs = store.jobs;
    const includeDisabled = opts?.includeDisabled === true;
    const filtered = includeDisabled
      ? jobs
      : jobs.filter((j) => j.enabled);
    return [...filtered].sort(
      (a: CronJob, b: CronJob) =>
        (a.state.nextRunAtMs ?? 0) - (b.state.nextRunAtMs ?? 0),
    );
  }

  async status(): Promise<{
    storePath: string;
    jobs: number;
    nextWakeAtMs: number | null;
  }> {
    const store = await this.ensureStore();
    const now = Date.now();
    for (const job of store.jobs) {
      recomputeNextRuns(job, now);
    }
    const next = nextWakeAtMs(store.jobs, now);
    return {
      storePath: this.storePath,
      jobs: store.jobs.length,
      nextWakeAtMs: next,
    };
  }

  async add(input: CronJobCreate): Promise<CronJob> {
    const store = await this.ensureStore();
    const now = Date.now();
    const job = createJob(now, input);
    store.jobs.push(job);
    await saveStore(this.storePath, store);
    return job;
  }

  async update(id: string, patch: CronJobPatch): Promise<CronJob> {
    const store = await this.ensureStore();
    const job = findJob(store.jobs, id);
    if (!job) throw new Error(`unknown cron job id: ${id}`);
    const now = Date.now();
    applyJobPatch(job, patch);
    job.updatedAtMs = now;
    recomputeNextRuns(job, now);
    await saveStore(this.storePath, store);
    return job;
  }

  async remove(id: string): Promise<{ removed: boolean }> {
    const store = await this.ensureStore();
    const before = store.jobs.length;
    store.jobs = store.jobs.filter((j) => j.id !== id);
    const removed = store.jobs.length !== before;
    if (removed) await saveStore(this.storePath, store);
    return { removed };
  }

  /**
   * Mark job as run and advance nextRunAtMs. Does not execute agent (no openclaw).
   */
  async run(id: string, mode: "due" | "force" = "force"): Promise<
    | { ok: true; ran: true }
    | { ok: true; ran: false; reason: "not-due" | "already-running" }
    | { ok: false; error: string }
  > {
    const store = await this.ensureStore();
    const job = findJob(store.jobs, id);
    if (!job) return { ok: false, error: `unknown cron job id: ${id}` };
    const now = Date.now();
    const due =
      mode === "force" ||
      (job.enabled &&
        typeof job.state.nextRunAtMs === "number" &&
        now >= job.state.nextRunAtMs);
    if (!due)
      return { ok: true, ran: false, reason: "not-due" };
    job.state.lastRunAtMs = now;
    job.state.lastStatus = "ok";
    job.updatedAtMs = now;
    if (job.schedule.kind === "at" && job.state.lastStatus === "ok") {
      job.enabled = false;
      job.state.nextRunAtMs = undefined;
    } else if (job.enabled) {
      job.state.nextRunAtMs = computeJobNextRunAtMs(job, now);
    } else {
      job.state.nextRunAtMs = undefined;
    }
    if (
      job.schedule.kind === "at" &&
      job.deleteAfterRun === true &&
      job.state.lastStatus === "ok"
    ) {
      store.jobs = store.jobs.filter((j) => j.id !== id);
    }
    await saveStore(this.storePath, store);
    return { ok: true, ran: true };
  }
}
