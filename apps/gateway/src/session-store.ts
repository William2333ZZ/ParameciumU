/**
 * Session store：从磁盘读写 sessions.json（sessionKey -> SessionEntry）。
 * 支持文件锁（并发安全）、TTL 缓存、freshness 过期策略。
 */

import fs from "node:fs";
import path from "node:path";
import type { SessionResetPolicy } from "./session-reset.js";
import { evaluateSessionFreshness } from "./session-reset.js";
import { initTranscript } from "./session-transcript.js";
import type { SessionEntry, SessionStore } from "./session-types.js";

export const SESSIONS_DIR = "sessions";
export const SESSIONS_FILE = "sessions.json";
/** 所有会话的 transcript 存放目录（相对于 sessions 目录） */
export const TRANSCRIPTS_DIR = "transcripts";

export function resolveSessionStorePath(gatewayDataDir: string): string {
	return path.join(gatewayDataDir, SESSIONS_DIR, SESSIONS_FILE);
}

/** 任意 sessionKey 的 transcript 文件路径，统一在 .gateway/sessions/transcripts/ 下 */
export function getTranscriptPathForSessionKey(storePath: string, sessionKey: string): string {
	const safe = sessionKey.replace(/[^a-zA-Z0-9.-]/g, "-");
	return path.join(path.dirname(storePath), TRANSCRIPTS_DIR, `${safe}.json`);
}

/** resolveSession 的 fallback 用 transcript 路径（仅当无 storePath 时用到） */
const FALLBACK_PATH_KEY = "agent:.u:default";
export function getDefaultTranscriptPath(storePath: string): string {
	return getTranscriptPathForSessionKey(storePath, FALLBACK_PATH_KEY);
}

/** @deprecated 使用 getDefaultTranscriptPath */
export const getMainTranscriptPath = getDefaultTranscriptPath;

const CACHE_TTL_MS = 45_000;

type CacheEntry = { store: SessionStore; loadedAt: number };
const cache = new Map<string, CacheEntry>();

function isSessionStoreRecord(value: unknown): value is SessionStore {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function invalidateCache(storePath: string): void {
	cache.delete(storePath);
}

export function loadSessionStore(storePath: string, opts?: { skipCache?: boolean }): SessionStore {
	if (!opts?.skipCache) {
		const hit = cache.get(storePath);
		if (hit && Date.now() - hit.loadedAt <= CACHE_TTL_MS) {
			return JSON.parse(JSON.stringify(hit.store)) as SessionStore;
		}
	}
	try {
		const raw = fs.readFileSync(storePath, "utf-8");
		const parsed = JSON.parse(raw) as unknown;
		if (isSessionStoreRecord(parsed)) {
			const store = parsed as SessionStore;
			if (!opts?.skipCache) cache.set(storePath, { store: JSON.parse(JSON.stringify(store)), loadedAt: Date.now() });
			return store;
		}
	} catch {
		// 文件不存在或非法则返回空
	}
	return {};
}

function saveSessionStoreUnlocked(storePath: string, store: SessionStore): void {
	invalidateCache(storePath);
	const dir = path.dirname(storePath);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(storePath, JSON.stringify(store, null, 2), "utf-8");
}

const LOCK_STALE_MS = 30_000;
const LOCK_POLL_MS = 25;
const LOCK_TIMEOUT_MS = 10_000;

function withSessionStoreLockSync<T>(storePath: string, fn: () => T): T {
	const lockPath = `${storePath}.lock`;
	const dir = path.dirname(storePath);
	fs.mkdirSync(dir, { recursive: true });
	const startedAt = Date.now();
	for (;;) {
		try {
			const fd = fs.openSync(lockPath, "wx");
			fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() }));
			fs.closeSync(fd);
			break;
		} catch (err: unknown) {
			const code = err && typeof err === "object" && "code" in err ? (err as { code: string }).code : "";
			if (code !== "EEXIST") throw err;
			if (Date.now() - startedAt > LOCK_TIMEOUT_MS) {
				throw new Error(`session store lock timeout: ${lockPath}`);
			}
			try {
				const st = fs.statSync(lockPath);
				if (Date.now() - st.mtimeMs > LOCK_STALE_MS) fs.unlinkSync(lockPath);
			} catch {
				// ignore
			}
			const deadline = Date.now() + LOCK_POLL_MS;
			while (Date.now() < deadline) {
				// busy wait
			}
		}
	}
	try {
		return fn();
	} finally {
		try {
			fs.unlinkSync(lockPath);
		} catch {
			// ignore
		}
	}
}

export function saveSessionStore(storePath: string, store: SessionStore): void {
	withSessionStoreLockSync(storePath, () => {
		saveSessionStoreUnlocked(storePath, store);
	});
}

/**
 * 确保 session store 文件与目录存在（空 store 即可），不预创建任何 session key。
 * 未指定 sessionKey 时由 resolveSession 按时间生成新 key（agent:.u:s-<timestamp>-<random>）。
 */
export function ensureSessionStoreReady(storePath: string): SessionStore {
	const store = loadSessionStore(storePath);
	const dir = path.dirname(storePath);
	fs.mkdirSync(dir, { recursive: true });
	if (!fs.existsSync(storePath)) {
		saveSessionStoreUnlocked(storePath, {});
	}
	return store;
}

/**
 * 清空 session store（写空 {}）并删除 transcripts 目录下所有文件。
 * 用于升级到树形 transcript 后丢弃旧线性历史，启动时调用一次。
 */
export function clearSessionStoreAndTranscripts(storePath: string): void {
	invalidateCache(storePath);
	const dir = path.dirname(storePath);
	const transcriptsDir = path.join(dir, TRANSCRIPTS_DIR);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(storePath, JSON.stringify({}, null, 2), "utf-8");
	if (fs.existsSync(transcriptsDir)) {
		for (const name of fs.readdirSync(transcriptsDir)) {
			const p = path.join(transcriptsDir, name);
			if (fs.statSync(p).isFile()) {
				try {
					fs.unlinkSync(p);
				} catch {
					// ignore
				}
			}
		}
	}
}

export type ResolveSessionOptions = {
	storePath?: string;
	resetPolicy?: SessionResetPolicy | null;
};

/**
 * 根据 sessionKey 或 sessionId 解析出 SessionEntry 与 transcript 路径。
 * 未传 sessionKey 时始终按时间新建 key：agent:.u:s-<timestamp>-<random>。始终返回 sessionKey。
 * 若提供 storePath 与 resetPolicy，则按 freshness 判断：过期则新建 sessionId、清空 transcript 并写回 store。
 */
export function resolveSession(
	store: SessionStore,
	opts: { sessionKey?: string; sessionId?: string },
	mainTranscriptPath: string,
	resolveOpts?: ResolveSessionOptions,
): { entry: SessionEntry; sessionKey: string; transcriptPath: string; isNewSession?: boolean } {
	let sessionKey = opts.sessionKey?.trim();
	let transcriptPath = mainTranscriptPath;
	let entry: SessionEntry | undefined;

	if (sessionKey && store[sessionKey]) {
		entry = store[sessionKey]!;
		transcriptPath = entry.transcriptPath ?? mainTranscriptPath;
	} else if (opts.sessionId?.trim()) {
		const found = Object.entries(store).find(([, e]) => e.sessionId === opts.sessionId);
		if (found) {
			[sessionKey, entry] = [found[0], found[1]];
			transcriptPath = entry!.transcriptPath ?? mainTranscriptPath;
		}
	}

	if (!sessionKey) {
		const now = Date.now();
		sessionKey = `agent:.u:s-${now}-${Math.random().toString(36).slice(2, 10)}`;
		entry = undefined;
	}

	const now = Date.now();
	const policy = resolveOpts?.resetPolicy ?? null;
	const storePath = resolveOpts?.storePath;

	if (entry && policy && policy.mode !== "none" && storePath) {
		const freshness = evaluateSessionFreshness({
			updatedAt: entry.updatedAt,
			now,
			policy,
		});
		if (!freshness.fresh) {
			const newSessionId = `main-${now}-${Math.random().toString(36).slice(2, 10)}`;
			const newEntry: SessionEntry = {
				...entry,
				sessionId: newSessionId,
				updatedAt: now,
				leafId: null,
			};
			store[sessionKey] = newEntry;
			initTranscript(transcriptPath, newSessionId);
			withSessionStoreLockSync(storePath, () => {
				saveSessionStoreUnlocked(storePath, store);
			});
			return {
				entry: newEntry,
				sessionKey,
				transcriptPath,
				isNewSession: true,
			};
		}
	}

	if (!entry) {
		const sessionId = `s-${now}-${Math.random().toString(36).slice(2, 10)}`;
		const transcriptPathForNew = storePath
			? getTranscriptPathForSessionKey(storePath, sessionKey)
			: mainTranscriptPath;
		const displayName = sessionKey.split(":").pop() ?? sessionId.slice(0, 12);
		entry = {
			sessionId,
			updatedAt: now,
			transcriptPath: transcriptPathForNew,
			displayName,
			channel: "webchat",
			leafId: null,
		};
		store[sessionKey] = entry;
		initTranscript(transcriptPathForNew, sessionId);
		if (storePath) {
			withSessionStoreLockSync(storePath, () => {
				saveSessionStoreUnlocked(storePath, store);
			});
		}
	}

	return {
		entry,
		sessionKey,
		transcriptPath: entry.transcriptPath ?? mainTranscriptPath,
	};
}

/**
 * 更新 store 中某 session 的字段并写回磁盘（带锁）。
 */
export function updateSessionEntry(storePath: string, sessionKey: string, patch: Partial<SessionEntry>): void {
	withSessionStoreLockSync(storePath, () => {
		const store = loadSessionStore(storePath, { skipCache: true });
		const entry = store[sessionKey];
		if (!entry) return;
		const now = Date.now();
		store[sessionKey] = {
			...entry,
			...patch,
			updatedAt: patch.updatedAt ?? now,
		};
		saveSessionStoreUnlocked(storePath, store);
	});
}

/**
 * 在锁内执行对 store 的读-改-写（用于 sessions.patch 等）。
 */
export function updateSessionStoreSync<T>(storePath: string, mutator: (store: SessionStore) => T): T {
	return withSessionStoreLockSync(storePath, () => {
		const store = loadSessionStore(storePath, { skipCache: true });
		const result = mutator(store);
		saveSessionStoreUnlocked(storePath, store);
		return result;
	});
}

/**
 * 删除指定会话：从 store 移除并删除对应 transcript 文件。
 * @returns 被删除的 entry，若 sessionKey 不存在则返回 null
 */
export function removeSession(storePath: string, sessionKey: string): SessionEntry | null {
	const deleted = updateSessionStoreSync<SessionEntry | null>(storePath, (store) => {
		const entry = store[sessionKey];
		if (!entry) return null;
		delete store[sessionKey];
		return entry;
	});
	if (deleted) {
		const transcriptPath = deleted.transcriptPath ?? getTranscriptPathForSessionKey(storePath, sessionKey);
		try {
			if (fs.existsSync(transcriptPath)) fs.unlinkSync(transcriptPath);
		} catch {
			// ignore
		}
	}
	return deleted;
}
