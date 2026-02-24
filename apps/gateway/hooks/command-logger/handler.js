/**
 * command-logger：gateway:startup 时追加一条日志到 .gateway/hooks/command-logger.log
 * 需在 Gateway 的 gatewayDataDir 下存在 hooks 目录（或使用 managed hooks 目录）。
 */
import fs from "node:fs";
import path from "node:path";

export default function commandLogger(event) {
  const dir = event.context?.gatewayDataDir;
  if (!dir) return;
  const logDir = path.join(dir, "hooks");
  const logFile = path.join(logDir, "command-logger.log");
  try {
    fs.mkdirSync(logDir, { recursive: true });
    const line = `${new Date().toISOString()} gateway:startup rootDir=${event.context?.rootDir ?? ""}\n`;
    fs.appendFileSync(logFile, line);
  } catch (err) {
    console.error("[hooks] command-logger write failed:", err.message);
  }
}
