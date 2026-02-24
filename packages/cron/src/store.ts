/**
 * Load/save cron store from JSON file. No openclaw dependency.
 */

import fs from "node:fs";
import path from "node:path";
import type { CronStoreFile } from "./types.js";

export async function loadStore(storePath: string): Promise<CronStoreFile> {
  try {
    const raw = await fs.promises.readFile(storePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    const record =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    const jobs = Array.isArray(record.jobs) ? record.jobs : [];
    return {
      version: 1,
      jobs: jobs.filter(Boolean) as CronStoreFile["jobs"],
    };
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === "ENOENT") return { version: 1, jobs: [] };
    throw err;
  }
}

export async function saveStore(
  storePath: string,
  store: CronStoreFile,
): Promise<void> {
  await fs.promises.mkdir(path.dirname(storePath), { recursive: true });
  const tmp = `${storePath}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(store, null, 2), "utf-8");
  await fs.promises.rename(tmp, storePath);
}
