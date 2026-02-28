#!/usr/bin/env node
/**
 * 常驻调度器 CLI：使用 CRON_STORE 或默认 ./.u/cron/jobs.json，循环执行到期任务。
 * 用法：npx @monou/cron  或  node dist/cli.js
 */

import { getDefaultStorePath } from "./index.js";
import { runScheduler } from "./scheduler.js";

async function main() {
	const storePath = getDefaultStorePath(process.cwd());
	await runScheduler(storePath);
}

main().catch((err) => {
	console.error("[cron-scheduler] fatal:", err);
	process.exit(1);
});
