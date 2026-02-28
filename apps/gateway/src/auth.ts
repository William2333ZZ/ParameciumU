/**
 * Gateway 认证：从环境变量读取 token/password，connect 时做 timing-safe 校验。
 */

import { timingSafeEqual } from "node:crypto";

export type AuthConfig = {
	/** 若设置了 token 或 password，则要求首条 connect 通过认证 */
	token?: string;
	password?: string;
};

const EMPTY = "";

/**
 * 从环境变量解析认证配置。
 * GATEWAY_TOKEN 或 GATEWAY_PASSWORD 任一非空即启用认证；客户端 connect 时提供 token 或 password 任一匹配即可。
 */
export function resolveAuthConfig(): AuthConfig {
	const token = process.env.GATEWAY_TOKEN?.trim();
	const password = process.env.GATEWAY_PASSWORD?.trim();
	return { token: token || undefined, password: password || undefined };
}

/** 是否要求认证（配置了 token 或 password） */
export function isAuthRequired(config: AuthConfig): boolean {
	return (config.token != null && config.token !== EMPTY) || (config.password != null && config.password !== EMPTY);
}

function safeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	try {
		return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
	} catch {
		return false;
	}
}

/**
 * 校验 connect 的 params：必须提供 token 或 password 之一，与配置做 timing-safe 比较。
 */
export function verifyConnect(config: AuthConfig, params: Record<string, unknown>): { ok: boolean; reason?: string } {
	if (!isAuthRequired(config)) return { ok: true };

	const providedToken = typeof params?.token === "string" ? params.token.trim() : undefined;
	const providedPassword = typeof params?.password === "string" ? params.password.trim() : undefined;

	if (
		config.token != null &&
		config.token !== EMPTY &&
		providedToken != null &&
		safeEqual(config.token, providedToken)
	)
		return { ok: true };
	if (
		config.password != null &&
		config.password !== EMPTY &&
		providedPassword != null &&
		safeEqual(config.password, providedPassword)
	)
		return { ok: true };

	return { ok: false, reason: "Invalid or missing token/password" };
}
