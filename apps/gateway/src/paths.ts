/**
 * Gateway 数据目录：默认 ./.gateway（以 cwd 为基准），与 OpenClaw 的 ~/.openclaw 对应、但为项目内目录。
 * 环境变量 GATEWAY_DATA_DIR 或 GATEWAY_STATE_DIR 可覆盖。
 */

import fs from "node:fs";
import path from "node:path";

export function resolveGatewayDataDir(cwd: string = process.cwd()): string {
	const env = process.env.GATEWAY_DATA_DIR?.trim() || process.env.GATEWAY_STATE_DIR?.trim();
	if (env) return path.resolve(cwd, env);
	return path.join(cwd, ".gateway");
}

export function ensureGatewayDataDir(dataDir: string): void {
	fs.mkdirSync(dataDir, { recursive: true });
}

export const MAPPINGS_FILE = "mappings.json";
