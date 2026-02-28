/**
 * 常驻调度器：按 nextWakeAtMs 循环唤醒，执行到期任务（更新状态，可选回调执行 agent）。
 * 不依赖 openclaw。
 */

import { CronStore } from "./index.js";
import type { CronJob } from "./types.js";

const MAX_SLEEP_MS = 60_000;

export type SchedulerOptions = {
	/** 任务到期时除更新 store 外，可在此回调中执行 agent 等逻辑 */
	onJobDue?: (job: CronJob) => Promise<void>;
	/**
	 * 可选：是否真正执行该任务。返回 false 时仍会推进 schedule（store.run），但不调用 onJobDue。
	 * 用于例如 heartbeat 的 activeHours：时段外跳过执行但下次仍按间隔触发。
	 */
	shouldRunJob?: (job: CronJob, nowMs: number) => boolean | Promise<boolean>;
	/** 简单日志；不传则用 console */
	log?: {
		info: (msg: string, data?: Record<string, unknown>) => void;
		warn: (msg: string, data?: Record<string, unknown>) => void;
	};
};

const defaultLog = {
	info: (msg: string, data?: Record<string, unknown>) => console.log("[cron-scheduler]", msg, data ?? ""),
	warn: (msg: string, data?: Record<string, unknown>) => console.warn("[cron-scheduler]", msg, data ?? ""),
};

/**
 * 运行常驻调度器：循环等待到下次唤醒时间（最多 60s），加载 store，执行到期任务后继续。
 * 默认只更新任务状态（lastRunAtMs、nextRunAtMs）；若传 onJobDue，会在每次到期时调用以便执行 agent。
 */
export async function runScheduler(storePath: string, options: SchedulerOptions = {}): Promise<never> {
	const store = new CronStore(storePath);
	const log = options.log ?? defaultLog;
	const onJobDue = options.onJobDue;
	const shouldRunJob = options.shouldRunJob;

	log.info("scheduler started", { storePath });

	for (;;) {
		const now = Date.now();
		const status = await store.status();
		const nextWake = status.nextWakeAtMs;

		const delayMs = nextWake == null ? MAX_SLEEP_MS : Math.min(Math.max(0, nextWake - now), MAX_SLEEP_MS);

		if (delayMs > 0) {
			await new Promise<void>((r) => setTimeout(r, delayMs));
		}

		const list = await store.list({ includeDisabled: false });
		const now2 = Date.now();
		const due = list.filter(
			(j) => j.enabled && typeof j.state.nextRunAtMs === "number" && now2 >= j.state.nextRunAtMs,
		);

		for (const job of due) {
			try {
				const runNow = shouldRunJob ? await Promise.resolve(shouldRunJob(job, now2)) : true;
				const result = await store.run(job.id, "due");
				if (result.ok && result.ran) {
					log.info("job ran", { jobId: job.id, name: job.name, skipped: !runNow });
					if (runNow && onJobDue) {
						try {
							await onJobDue(job);
						} catch (err) {
							log.warn("onJobDue failed", {
								jobId: job.id,
								error: String(err),
							});
						}
					}
				}
			} catch (err) {
				log.warn("run job failed", { jobId: job.id, error: String(err) });
			}
		}
	}
}
