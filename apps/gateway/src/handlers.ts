/**
 * Gateway RPC 实现：health、cron.*、connect、agents、sessions、sessions.patch、agent、agent.wait、chat.history、chat.send、chat.abort、skills.status、node.*
 */

import os from "node:os";
import path from "node:path";
import type { CronStore } from "@monou/cron";
import type { CronJobCreate, CronJobPatch } from "@monou/cron";
import type { GatewayResponse, ErrorShape, ConnectIdentity } from "@monou/gateway";
import type { GatewayContext, ConnectionEntry, ConnectorMapping } from "./context.js";
import {
  getAgentsFromConnections,
  getNodesFromConnections,
  getConnectorsFromConnections,
  DEFAULT_LOCAL_AGENT_ID,
} from "./context.js";
import {
  loadSessionStore,
  resolveSession,
  updateSessionEntry,
  updateSessionStoreSync,
  removeSession,
  getTranscriptPathForSessionKey,
} from "./session-store.js";
import {
  loadTranscript,
  appendTranscriptMessages,
  loadTranscriptTree,
  initTranscript,
} from "./session-transcript.js";
import {
  isSessionActive,
  setActiveRun,
  clearActiveRunByRunId,
  onRunComplete,
  enqueue,
} from "./queue.js";
import { getSessionResetPolicy, parseResetTrigger } from "./session-reset.js";
import type { SessionEntry } from "./session-types.js";

const INVALID_REQUEST = 400;
const NOT_FOUND = 404;

function err(code: number, message: string): ErrorShape {
  return { code, message };
}

function ok<T>(payload: T, meta?: Record<string, unknown>): GatewayResponse {
  return { ok: true, payload, ...(meta && { meta }) };
}

function fail(error: ErrorShape): GatewayResponse {
  return { ok: false, error };
}

export type RequestContext = { connId: string; entry: ConnectionEntry };

export type HandlersContext = GatewayContext & {
  runAgent?: (
    rootDir: string,
    message: string,
    opts?: {
      agentDir?: string;
      transcriptPath?: string;
      leafId?: string | null;
      signal?: AbortSignal;
      onTextChunk?: (text: string) => void;
    },
  ) => Promise<{ text: string; toolCalls?: Array<{ name: string; arguments?: string }>; newLeafId?: string }>;
};

export function createHandlers(ctx: HandlersContext) {
  const {
    cronStore,
    connections,
    pendingInvokes,
    nextInvokeId,
    nextRunId,
    inFlightAgentRuns,
    runIdToPromise,
    runIdToAbort,
    connectorMappings,
    nextMappingId,
    persistConnectorMappings,
    sessionStorePath,
    mainTranscriptPath,
  } = ctx;
  const resetPolicy = getSessionResetPolicy();

  return {
    connect: async (params: Record<string, unknown>): Promise<GatewayResponse> => {
      const identity = params as unknown as ConnectIdentity;
      return ok({ ok: true, message: "connected", identity: identity?.role ? identity : undefined });
    },

    health: async (): Promise<GatewayResponse> => {
      const status = await cronStore.status();
      return ok({
        ok: true,
        ts: Date.now(),
        startedAt: ctx.startedAt,
        cron: { storePath: status.storePath, jobs: status.jobs, nextWakeAtMs: status.nextWakeAtMs },
      });
    },

    status: async (): Promise<GatewayResponse> => {
      const status = await cronStore.status();
      const agents = getAgentsFromConnections(connections);
      const nodes = getNodesFromConnections(connections);
      return ok({
        ok: true,
        ts: Date.now(),
        cron: status,
        agents: agents.length,
        nodes: nodes.length,
      });
    },

    "cron.list": async (params: Record<string, unknown>): Promise<GatewayResponse> => {
      const includeDisabled = params?.includeDisabled === true;
      const jobs = await cronStore.list({ includeDisabled });
      return ok({ jobs });
    },

    "cron.status": async (): Promise<GatewayResponse> => {
      const status = await cronStore.status();
      return ok({
        schedulerRunning: false,
        storePath: status.storePath,
        jobs: status.jobs,
        nextWakeAtMs: status.nextWakeAtMs,
      });
    },

    "cron.add": async (params: Record<string, unknown>): Promise<GatewayResponse> => {
      if (!params || typeof params !== "object") return fail(err(INVALID_REQUEST, "cron.add requires params"));
      try {
        const job = await cronStore.add(params as unknown as CronJobCreate);
        return ok(job);
      } catch (e) {
        return fail(err(INVALID_REQUEST, (e as Error).message));
      }
    },

    "cron.update": async (params: Record<string, unknown>): Promise<GatewayResponse> => {
      const id = params?.id;
      if (typeof id !== "string") return fail(err(INVALID_REQUEST, "cron.update requires params.id"));
      const patch = { ...params, id: undefined } as CronJobPatch;
      try {
        const job = await cronStore.update(id, patch);
        return ok(job);
      } catch (e) {
        return fail(err((e as Error).message.includes("unknown") ? NOT_FOUND : INVALID_REQUEST, (e as Error).message));
      }
    },

    "cron.remove": async (params: Record<string, unknown>): Promise<GatewayResponse> => {
      const id = params?.id;
      if (typeof id !== "string") return fail(err(INVALID_REQUEST, "cron.remove requires params.id"));
      const result = await cronStore.remove(id);
      return ok(result);
    },

    "cron.run": async (params: Record<string, unknown>): Promise<GatewayResponse> => {
      const id = params?.id;
      if (typeof id !== "string") return fail(err(INVALID_REQUEST, "cron.run requires params.id"));
      const mode = params?.mode === "due" ? "due" : "force";
      const result = await cronStore.run(id, mode);
      return ok(result);
    },

    "cron.runs": async (): Promise<GatewayResponse> => ok({ runs: [] }),

    "agents.list": async (): Promise<GatewayResponse> => {
      const agents = getAgentsFromConnections(connections);
      return ok({ agents });
    },

    /** Agent 执行完心跳任务后调用，用于更新 lastHeartbeatAt（agents.list 返回），供 UI 显示「最近活跃」 */
    "agent.heartbeat": async (_params: Record<string, unknown>, req?: RequestContext): Promise<GatewayResponse> => {
      const entry = req?.entry;
      if (entry?.identity?.role === "agent") {
        entry.lastHeartbeatAt = Date.now();
      }
      return ok({ ok: true });
    },

    "sessions.list": async (): Promise<GatewayResponse> => {
      const store = loadSessionStore(sessionStorePath, { skipCache: true });
      const sessions = Object.entries(store).map(([key, entry]) => ({
        key,
        sessionId: entry.sessionId,
        updatedAt: entry.updatedAt,
        displayName: entry.displayName,
        channel: entry.channel,
        contextTokens: entry.contextTokens,
        totalTokens: entry.totalTokens,
        model: entry.model,
        thinkingLevel: entry.thinkingLevel,
        sendPolicy: entry.sendPolicy,
        leafId: entry.leafId ?? null,
      }));
      return ok({ sessions, defaultAgentId: ".u" });
    },

    "sessions.preview": async (): Promise<GatewayResponse> => {
      const store = loadSessionStore(sessionStorePath, { skipCache: true });
      const sessions = Object.entries(store).map(([key, entry]) => ({
        key,
        sessionId: entry.sessionId,
        updatedAt: entry.updatedAt,
        displayName: entry.displayName,
        leafId: entry.leafId ?? null,
      }));
      return ok({ sessions });
    },

    "sessions.patch": async (params: Record<string, unknown>): Promise<GatewayResponse> => {
      const sessionKey = (params?.sessionKey as string)?.trim();
      const sessionId = (params?.sessionId as string)?.trim();
      const patch = params?.patch as Partial<SessionEntry> | undefined;
      if (!patch || typeof patch !== "object") {
        return fail(err(INVALID_REQUEST, "sessions.patch requires params.patch (object)"));
      }
      const allowedKeys = new Set([
        "displayName", "channel", "sendPolicy", "thinkingLevel",
        "contextTokens", "totalTokens", "model", "leafId",
      ]);
      const filtered: Partial<SessionEntry> = {};
      for (const [k, v] of Object.entries(patch)) {
        if (allowedKeys.has(k) && v !== undefined) (filtered as Record<string, unknown>)[k] = v;
      }
      if (Object.keys(filtered).length === 0) {
        return fail(err(INVALID_REQUEST, "sessions.patch: no allowed fields in patch"));
      }
      const updated = updateSessionStoreSync(sessionStorePath, (store) => {
        let key: string | undefined;
        if (sessionKey && store[sessionKey]) key = sessionKey;
        else if (sessionId) {
          const found = Object.entries(store).find(([, e]) => e.sessionId === sessionId);
          if (found) key = found[0];
        }
        if (!key) return null;
        const entry = store[key]!;
        store[key] = { ...entry, ...filtered, sessionId: entry.sessionId, updatedAt: entry.updatedAt };
        return store[key]!;
      });
      if (updated == null) return fail(err(NOT_FOUND, "session not found"));
      return ok(updated);
    },

    "sessions.delete": async (params: Record<string, unknown>): Promise<GatewayResponse> => {
      const sessionKey = (params?.sessionKey as string)?.trim();
      const sessionId = (params?.sessionId as string)?.trim();
      if (!sessionKey && !sessionId) {
        return fail(err(INVALID_REQUEST, "sessions.delete requires params.sessionKey or params.sessionId"));
      }
      const store = loadSessionStore(sessionStorePath, { skipCache: true });
      let key: string | undefined;
      if (sessionKey && store[sessionKey]) key = sessionKey;
      else if (sessionId) {
        const found = Object.entries(store).find(([, e]) => e.sessionId === sessionId);
        if (found) key = found[0];
      }
      if (!key) return fail(err(NOT_FOUND, "session not found"));
      const removed = removeSession(sessionStorePath, key);
      if (!removed) return fail(err(NOT_FOUND, "session not found"));
      return ok({ removed: true, sessionKey: key });
    },

    "sessions.getTree": async (params: Record<string, unknown>): Promise<GatewayResponse> => {
      const sessionKey = (params?.sessionKey as string)?.trim();
      const sessionId = (params?.sessionId as string)?.trim();
      if (!sessionKey && !sessionId) {
        return fail(err(INVALID_REQUEST, "sessions.getTree requires params.sessionKey or params.sessionId"));
      }
      const store = loadSessionStore(sessionStorePath, { skipCache: true });
      let key: string | undefined;
      let entry: SessionEntry | undefined;
      if (sessionKey && store[sessionKey]) {
        key = sessionKey;
        entry = store[sessionKey];
      } else if (sessionId) {
        const found = Object.entries(store).find(([, e]) => e.sessionId === sessionId);
        if (found) [key, entry] = [found[0], found[1]];
      }
      if (!key || !entry) return fail(err(NOT_FOUND, "session not found"));
      const transcriptPath = entry.transcriptPath ?? getTranscriptPathForSessionKey(sessionStorePath, key);
      const { header, entries } = loadTranscriptTree(transcriptPath);
      return ok({
        sessionKey: key,
        sessionId: entry.sessionId,
        currentLeafId: entry.leafId ?? null,
        header: header ?? null,
        entries: entries.map((e) => ({ id: e.id, parentId: e.parentId, timestamp: e.timestamp, message: e.message })),
      });
    },

    "sessions.navigate": async (params: Record<string, unknown>): Promise<GatewayResponse> => {
      const sessionKey = (params?.sessionKey as string)?.trim();
      const sessionId = (params?.sessionId as string)?.trim();
      const leafId = params?.leafId == null ? undefined : String(params.leafId);
      if (leafId === undefined) {
        return fail(err(INVALID_REQUEST, "sessions.navigate requires params.leafId"));
      }
      const store = loadSessionStore(sessionStorePath, { skipCache: true });
      let key: string | undefined;
      if (sessionKey && store[sessionKey]) key = sessionKey;
      else if (sessionId) {
        const found = Object.entries(store).find(([, e]) => e.sessionId === sessionId);
        if (found) key = found[0];
      }
      if (!key) return fail(err(NOT_FOUND, "session not found"));
      updateSessionEntry(sessionStorePath, key, { leafId: leafId || null });
      const updated = loadSessionStore(sessionStorePath, { skipCache: true })[key]!;
      return ok({ sessionKey: key, leafId: updated.leafId ?? null });
    },

    "sessions.fork": async (params: Record<string, unknown>): Promise<GatewayResponse> => {
      const sessionKey = (params?.sessionKey as string)?.trim();
      const sessionId = (params?.sessionId as string)?.trim();
      const parentLeafId = params?.parentLeafId == null ? undefined : String(params.parentLeafId);
      const store = loadSessionStore(sessionStorePath, { skipCache: true });
      let key: string | undefined;
      let entry: SessionEntry | undefined;
      if (sessionKey && store[sessionKey]) {
        key = sessionKey;
        entry = store[sessionKey];
      } else if (sessionId) {
        const found = Object.entries(store).find(([, e]) => e.sessionId === sessionId);
        if (found) [key, entry] = [found[0], found[1]];
      }
      if (!key || !entry) return fail(err(NOT_FOUND, "session not found"));
      const baseLeafId = parentLeafId ?? entry.leafId ?? null;
      const now = Date.now();
      const newKey = `agent:.u:s-${now}-${Math.random().toString(36).slice(2, 10)}`;
      const newSessionId = `s-${now}-${Math.random().toString(36).slice(2, 10)}`;
      const newTranscriptPath = getTranscriptPathForSessionKey(sessionStorePath, newKey);
      const transcriptPath = entry.transcriptPath ?? getTranscriptPathForSessionKey(sessionStorePath, key);
      const fs = await import("node:fs");
      if (fs.existsSync(transcriptPath)) {
        fs.copyFileSync(transcriptPath, newTranscriptPath);
      } else {
        initTranscript(newTranscriptPath, newSessionId);
      }
      const newEntry: SessionEntry = {
        sessionId: newSessionId,
        updatedAt: now,
        transcriptPath: newTranscriptPath,
        displayName: newKey.split(":").pop() ?? newSessionId.slice(0, 12),
        channel: entry.channel ?? "webchat",
        leafId: baseLeafId,
      };
      updateSessionStoreSync(sessionStorePath, (s) => {
        s[newKey] = newEntry;
      });
      return ok({ sessionKey: newKey, sessionId: newSessionId, leafId: baseLeafId });
    },

    agent: async (
      params: Record<string, unknown>,
      req?: RequestContext,
    ): Promise<GatewayResponse> => {
      let message = params?.message;
      if (typeof message !== "string") return fail(err(INVALID_REQUEST, "agent requires params.message"));

      const agentId = (params?.agentId as string)?.trim() || ".u";
      const nodeId = params?.nodeId as string | undefined;
      const deviceId = params?.deviceId as string | undefined;
      const connectorId = params?.connectorId as string | undefined;

      // 按 agentId 派发到已连接的 agent（含 .u）：找到连接则转发 node.invoke，不依赖 ctx.runAgent
      const nodes = getNodesFromConnections(connections);
      const agentSlot = nodes.flatMap((n) => n.agents).find((a) => a.agentId === agentId);
      const connId = agentSlot?.connId;
      if (typeof connId === "string" && connId.length > 0) {
        const entry = connections.get(connId);
        if (entry?.ws.readyState === 1) {
          const sessionKey = (params?.sessionKey as string)?.trim() || req?.entry?.sessionKey?.trim();
          const sessionId = (params?.sessionId as string)?.trim();
          const store = loadSessionStore(sessionStorePath);
          const resolveOpts = { storePath: sessionStorePath, resetPolicy };
          const { sessionKey: resolvedKey, transcriptPath, entry: remoteEntry } = resolveSession(
            store,
            { sessionKey: sessionKey || undefined, sessionId },
            mainTranscriptPath,
            resolveOpts,
          );
          const id = nextInvokeId();
          return new Promise<GatewayResponse>((resolve) => {
            const timeout = setTimeout(() => {
              if (ctx.pendingInvokes.delete(id)) resolve(fail(err(504, "agent on node timeout")));
            }, 120_000);
            ctx.pendingInvokes.set(id, (result: unknown) => {
              clearTimeout(timeout);
              ctx.pendingInvokes.delete(id);
              const out = typeof result === "object" && result !== null && "text" in result
                ? (result as { text: string; toolCalls?: Array<{ name: string; arguments?: string }> })
                : { text: String(result ?? ""), toolCalls: [] };
              try {
                const assistantToolCalls = out.toolCalls?.map((tc, i) => ({
                  id: (tc as { id?: string }).id ?? `tc-${i}`,
                  name: tc.name,
                  arguments: tc.arguments,
                }));
                const toAppend = [
                  { role: "user" as const, content: message as string },
                  { role: "assistant" as const, content: out.text, ...(assistantToolCalls?.length ? { toolCalls: assistantToolCalls } : {}) },
                ];
                const newLeafId = appendTranscriptMessages(transcriptPath, remoteEntry?.leafId ?? null, toAppend);
                updateSessionEntry(sessionStorePath, resolvedKey, { leafId: newLeafId, updatedAt: Date.now() });
              } catch (_) {}
              resolve(ok(out));
            });
            entry.ws.send(JSON.stringify({ event: "node.invoke.request", payload: { id, __agent: true, message } }));
          });
        }
      }

      if (agentId !== DEFAULT_LOCAL_AGENT_ID) {
        return fail(err(503, `agent ${agentId} not connected (ensure the agent is running and connected to this gateway)`));
      }

      let targetNodeId = nodeId ?? deviceId;
      if (connectorId && connectorMappings.length > 0) {
        const mapping = connectorMappings.find((m) => m.connectorId === connectorId);
        if (mapping) targetNodeId = targetNodeId ?? mapping.nodeId ?? mapping.deviceId;
      }

      if (targetNodeId) {
        const nodes = getNodesFromConnections(connections);
        const node = nodes.find((n) => n.nodeId === targetNodeId || n.deviceId === targetNodeId || n.connId === targetNodeId);
        if (node) {
          const entry = connections.get(node.connId);
          if (entry?.ws.readyState === 1) {
            const sessionKey = (params?.sessionKey as string)?.trim() || req?.entry?.sessionKey?.trim();
            const sessionId = (params?.sessionId as string)?.trim();
            const store = loadSessionStore(sessionStorePath);
            const resolveOpts = { storePath: sessionStorePath, resetPolicy };
            const { sessionKey: resolvedKey, transcriptPath, entry: remoteEntry } = resolveSession(
              store,
              { sessionKey: sessionKey || undefined, sessionId },
              mainTranscriptPath,
              resolveOpts,
            );
            const id = nextInvokeId();
            return new Promise<GatewayResponse>((resolve) => {
              const timeout = setTimeout(() => {
                if (ctx.pendingInvokes.delete(id)) resolve(fail(err(504, "agent on node timeout")));
              }, 120_000);
              ctx.pendingInvokes.set(id, (result: unknown) => {
                clearTimeout(timeout);
                ctx.pendingInvokes.delete(id);
                const out = typeof result === "object" && result !== null && "text" in result
                  ? (result as { text: string; toolCalls?: Array<{ name: string; arguments?: string }> })
                  : { text: String(result ?? ""), toolCalls: [] };
                try {
                  const assistantToolCalls = out.toolCalls?.map((tc, i) => ({
                    id: (tc as { id?: string }).id ?? `tc-${i}`,
                    name: tc.name,
                    arguments: tc.arguments,
                  }));
                  const toAppend = [
                    { role: "user" as const, content: message as string },
                    { role: "assistant" as const, content: out.text, ...(assistantToolCalls?.length ? { toolCalls: assistantToolCalls } : {}) },
                  ];
                  const newLeafId = appendTranscriptMessages(transcriptPath, remoteEntry?.leafId ?? null, toAppend);
                  updateSessionEntry(sessionStorePath, resolvedKey, { leafId: newLeafId, updatedAt: Date.now() });
                } catch (_) {}
                resolve(ok(out));
              });
              entry.ws.send(JSON.stringify({ event: "node.invoke.request", payload: { id, __agent: true, message } }));
            });
          }
        }
      }

      if (!ctx.runAgent) return fail(err(501, "agent run not configured. 请先启动 agent（例如 npm run agent）并连接本 Gateway。"));

      const sessionKey =
        (params?.sessionKey as string)?.trim() || req?.entry?.sessionKey?.trim();
      const sessionId = (params?.sessionId as string)?.trim();
      const store = loadSessionStore(sessionStorePath);
      const resolveOpts = { storePath: sessionStorePath, resetPolicy };
      let resolved = resolveSession(
        store,
        { sessionKey: sessionKey || undefined, sessionId },
        mainTranscriptPath,
        resolveOpts,
      );
      let { sessionKey: resolvedKey, transcriptPath, entry } = resolved;

      const resetTrigger = parseResetTrigger(message);
      if (resetTrigger) {
        const newSessionId = `main-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        initTranscript(transcriptPath, newSessionId);
        updateSessionEntry(sessionStorePath, resolvedKey, { sessionId: newSessionId, leafId: null, updatedAt: Date.now() });
        entry = { ...entry, sessionId: newSessionId, leafId: null, updatedAt: Date.now() };
        store[resolvedKey] = entry;
        message = resetTrigger.rest || "";
      }

      const runId = nextRunId();
      const controller = new AbortController();
      runIdToAbort.set(runId, controller);
      const promise = new Promise<{ text: string; toolCalls?: Array<{ name: string; arguments?: string }> }>((resolve, reject) => {
        inFlightAgentRuns.set(runId, { resolve: resolve as (r: unknown) => void, reject });
      });
      runIdToPromise.set(runId, promise);

      if (ctx.broadcast) ctx.broadcast("agent.run.started" as string, { runId, sessionKey: resolvedKey });

      const doRun = () =>
        ctx.runAgent!(ctx.rootDir, message as string, {
          transcriptPath,
          leafId: entry?.leafId ?? undefined,
          signal: controller.signal,
          onTextChunk:
            ctx.broadcast && runId
              ? (chunk: string) => ctx.broadcast!("agent.run.chunk", { runId, chunk })
              : undefined,
        });

      doRun()
        .then((result) => {
          const patch: { updatedAt: number; leafId?: string } = { updatedAt: Date.now() };
          if (result.newLeafId != null) patch.leafId = result.newLeafId;
          updateSessionEntry(sessionStorePath, resolvedKey, patch);
          if (ctx.broadcast) ctx.broadcast("agent.run.done" as string, { runId, sessionKey: resolvedKey, text: result.text, toolCalls: result.toolCalls });
          inFlightAgentRuns.get(runId)?.resolve(result);
          inFlightAgentRuns.delete(runId);
          runIdToAbort.delete(runId);
          runIdToPromise.delete(runId);
        })
        .catch((e) => {
          inFlightAgentRuns.get(runId)?.reject(e as Error);
          inFlightAgentRuns.delete(runId);
          runIdToAbort.delete(runId);
          runIdToPromise.delete(runId);
        });

      const wait = params?.wait === true;
      if (wait) {
        try {
          const result = await promise;
          return ok({ runId, ...result });
        } catch (e) {
          return fail(err(500, (e as Error).message));
        }
      }
      return ok({ runId });
    },

    "agent.wait": async (params: Record<string, unknown>): Promise<GatewayResponse> => {
      const runId = (params?.runId as string)?.trim();
      if (!runId) return fail(err(INVALID_REQUEST, "agent.wait requires params.runId"));
      const promise = runIdToPromise.get(runId);
      if (!promise) return fail(err(NOT_FOUND, "run not found or already finished"));
      try {
        const result = await promise;
        return ok(result);
      } catch (e) {
        return fail(err(500, (e as Error).message));
      }
    },

    "chat.send": async (
      params: Record<string, unknown>,
      req?: RequestContext,
    ): Promise<GatewayResponse> => {
      const message = params?.message;
      if (typeof message !== "string") return fail(err(INVALID_REQUEST, "chat.send requires params.message"));
      const agentId = (params?.agentId as string)?.trim() || ".u";
      const sessionKey =
        (params?.sessionKey as string)?.trim() || req?.entry?.sessionKey?.trim();
      const sessionId = (params?.sessionId as string)?.trim();
      const store = loadSessionStore(sessionStorePath);
      const resolveOpts = { storePath: sessionStorePath, resetPolicy };
      const { sessionKey: resolvedKey, transcriptPath, entry: resolvedEntry } = resolveSession(
        store,
        { sessionKey: sessionKey || undefined, sessionId },
        mainTranscriptPath,
        resolveOpts,
      );

      if (ctx.sessionQueue && isSessionActive(ctx.sessionQueue, resolvedKey)) {
        enqueue(ctx.sessionQueue, resolvedKey, message);
        return ok({ queued: true });
      }

      // 根据 agentId 找到对应连接：远程 agent 有非空 connId，本机 .u 为 connId ""
      const nodes = getNodesFromConnections(connections);
      const agentSlot = nodes.flatMap((n) => n.agents).find((a) => a.agentId === agentId);
      const connId = agentSlot?.connId;
      const isRemote = typeof connId === "string" && connId.length > 0;

      const runOneTurnRemote = async (sk: string, msg: string): Promise<void> => {
        const st = loadSessionStore(sessionStorePath);
        const res = resolveSession(st, { sessionKey: sk }, mainTranscriptPath, resolveOpts);
        const tpath = res.transcriptPath;
        const rkey = res.sessionKey;
        const n = getNodesFromConnections(connections);
        const slot = n.flatMap((no) => no.agents).find((a) => a.agentId === agentId);
        const cid = slot?.connId;
        const ent = typeof cid === "string" && cid.length > 0 ? connections.get(cid) : undefined;
        if (!ent || ent.ws.readyState !== 1) return;
        const id = nextInvokeId();
        if (ctx.sessionQueue) setActiveRun(ctx.sessionQueue, rkey, id);
        await new Promise<void>((resolvePromise) => {
          const timeout = setTimeout(() => {
            if (pendingInvokes.delete(id)) {
              if (ctx.sessionQueue) clearActiveRunByRunId(ctx.sessionQueue, id);
              resolvePromise();
            }
          }, 120_000);
          pendingInvokes.set(id, (result: unknown) => {
            clearTimeout(timeout);
            pendingInvokes.delete(id);
            const out = typeof result === "object" && result !== null && "text" in result
              ? (result as { text: string; toolCalls?: Array<{ name: string; arguments?: string }> })
              : { text: String(result ?? ""), toolCalls: [] };
            try {
              const assistantToolCalls = out.toolCalls?.map((tc, i) => ({
                id: (tc as { id?: string }).id ?? `tc-${i}`,
                name: tc.name,
                arguments: tc.arguments,
              }));
              const toAppend = [
                { role: "user" as const, content: msg },
                { role: "assistant" as const, content: out.text, ...(assistantToolCalls?.length && { toolCalls: assistantToolCalls }) },
              ];
              const newLeafId = appendTranscriptMessages(tpath, res.entry?.leafId ?? null, toAppend);
              updateSessionEntry(sessionStorePath, rkey, { leafId: newLeafId, updatedAt: Date.now() });
            } catch (_) {}
            if (ctx.sessionQueue) {
              clearActiveRunByRunId(ctx.sessionQueue, id);
              onRunComplete(ctx.sessionQueue, rkey, (merged) => runOneTurnRemote(rkey, merged));
            }
            resolvePromise();
          });
          ent.ws.send(JSON.stringify({ event: "node.invoke.request", payload: { id, __agent: true, message: msg } }));
        });
      };

      if (isRemote) {
        const entry = connections.get(connId!);
        if (!entry || entry.ws.readyState !== 1) return fail(err(503, `agent ${agentId} not connected`));
        const id = nextInvokeId();
        if (ctx.sessionQueue) setActiveRun(ctx.sessionQueue, resolvedKey, id);
        return new Promise<GatewayResponse>((resolve) => {
          const timeout = setTimeout(() => {
            if (pendingInvokes.delete(id)) {
              if (ctx.sessionQueue) clearActiveRunByRunId(ctx.sessionQueue, id);
              resolve(fail(err(504, "agent response timeout")));
            }
          }, 120_000);
          pendingInvokes.set(id, (result: unknown) => {
            clearTimeout(timeout);
            pendingInvokes.delete(id);
            const out = typeof result === "object" && result !== null && "text" in result
              ? (result as { text: string; toolCalls?: Array<{ name: string; arguments?: string }> })
              : { text: String(result ?? ""), toolCalls: [] };
            try {
              const assistantToolCalls = out.toolCalls?.map((tc, i) => ({
                id: (tc as { id?: string }).id ?? `tc-${i}`,
                name: tc.name,
                arguments: tc.arguments,
              }));
              const toAppend = [
                { role: "user" as const, content: message },
                { role: "assistant" as const, content: out.text, ...(assistantToolCalls?.length && { toolCalls: assistantToolCalls }) },
              ];
              const newLeafId = appendTranscriptMessages(transcriptPath, resolvedEntry?.leafId ?? null, toAppend);
              updateSessionEntry(sessionStorePath, resolvedKey, { leafId: newLeafId, updatedAt: Date.now() });
            } catch (_) {}
            if (ctx.sessionQueue) {
              clearActiveRunByRunId(ctx.sessionQueue, id);
              onRunComplete(ctx.sessionQueue, resolvedKey, (merged) => runOneTurnRemote(resolvedKey, merged));
            }
            resolve(ok(out));
          });
          entry!.ws.send(JSON.stringify({ event: "node.invoke.request", payload: { id, __agent: true, message } }));
        });
      }

      // 仅当请求的是本机默认 .u 时才在本机跑；其它 agent 未找到连接则报错，避免误用 .u
      if (agentId !== DEFAULT_LOCAL_AGENT_ID) {
        return fail(err(503, `agent ${agentId} not connected (ensure the agent is running and connected to this gateway)`));
      }

      if (!ctx.runAgent) return fail(err(501, "agent run not configured. 请先启动 agent（例如 npm run agent）并连接本 Gateway。"));
      const runOneTurnLocal = async (sk: string, msg: string): Promise<{ text: string; toolCalls?: Array<{ name: string; arguments?: string }> }> => {
        const st = loadSessionStore(sessionStorePath);
        const res = resolveSession(st, { sessionKey: sk }, mainTranscriptPath, resolveOpts);
        const tpath = res.transcriptPath;
        const rkey = res.sessionKey;
        const runId = nextRunId();
        if (ctx.sessionQueue) setActiveRun(ctx.sessionQueue, rkey, runId);
        return ctx.runAgent!(ctx.rootDir, msg, { transcriptPath: tpath, leafId: res.entry?.leafId ?? undefined })
          .then((result) => {
            const patch: { updatedAt: number; leafId?: string } = { updatedAt: Date.now() };
            if (result.newLeafId != null) patch.leafId = result.newLeafId;
            updateSessionEntry(sessionStorePath, rkey, patch);
            return result;
          })
          .finally(() => {
            if (ctx.sessionQueue) {
              clearActiveRunByRunId(ctx.sessionQueue, runId);
              onRunComplete(ctx.sessionQueue, rkey, (merged) => runOneTurnLocal(rkey, merged).then(() => {}));
            }
          });
      };
      try {
        const result = await runOneTurnLocal(resolvedKey, message);
        return ok(result);
      } catch (e) {
        return fail(err(500, (e as Error).message));
      }
    },

    "chat.abort": async (params: Record<string, unknown>): Promise<GatewayResponse> => {
      const runId = (params?.runId as string)?.trim();
      if (!runId) return fail(err(INVALID_REQUEST, "chat.abort requires params.runId"));
      const controller = runIdToAbort.get(runId);
      if (!controller) return fail(err(NOT_FOUND, "run not found or already finished"));
      controller.abort();
      runIdToAbort.delete(runId);
      return ok({ runId, aborted: true });
    },

    "skills.status": async (params: Record<string, unknown>): Promise<GatewayResponse> => {
      try {
        const agentId = (params?.agentId as string)?.trim() || ".u";
        const agentDir =
          agentId === DEFAULT_LOCAL_AGENT_ID
            ? path.join(ctx.rootDir, ".u")
            : path.join(ctx.rootDir, "agents", agentId);
        const { buildSessionFromU } = await import("@monou/agent-from-dir");
        const session = await buildSessionFromU(ctx.rootDir, { agentDir });
        return ok({
          skillDirs: session.skillDirs,
          tools: session.mergedTools.map((t) => t.name),
        });
      } catch (e) {
        return fail(err(500, (e as Error).message));
      }
    },

    "chat.history": async (
      params: Record<string, unknown>,
      req?: RequestContext,
    ): Promise<GatewayResponse> => {
      const sessionKey =
        (params?.sessionKey as string)?.trim() || req?.entry?.sessionKey?.trim();
      const sessionId = (params?.sessionId as string)?.trim();
      const limit = typeof params?.limit === "number" ? Math.min(Math.max(0, params.limit), 500) : 100;
      // skipCache：保证新建会话刚写入 store 后能立即读到；storePath：未命中时用正确 transcript 路径而非 main
      const store = loadSessionStore(sessionStorePath, { skipCache: true });
      const { transcriptPath, entry: historyEntry } = resolveSession(
        store,
        { sessionKey: sessionKey || undefined, sessionId },
        mainTranscriptPath,
        { storePath: sessionStorePath },
      );
      const stored = loadTranscript(transcriptPath, historyEntry?.leafId);
      const messages = stored.slice(-limit).map((m) => ({
        role: m.role,
        content: m.content ?? "",
        ...(m.toolCalls && { toolCalls: m.toolCalls }),
        ...(m.toolCallId && { toolCallId: m.toolCallId }),
        ...(m.isError !== undefined && { isError: m.isError }),
      }));
      return ok({ messages });
    },

    "node.list": async (): Promise<GatewayResponse> => {
      let nodes = getNodesFromConnections(connections);
      const agents = getAgentsFromConnections(connections);
      const connectors = getConnectorsFromConnections(connections);
      const localHostname = os.hostname();
      const localNode = nodes.find((n) => n.nodeId === localHostname || n.deviceId === localHostname);
      if (localNode) {
        const hasU = localNode.agents.some((a) => a.agentId === DEFAULT_LOCAL_AGENT_ID);
        if (!hasU) {
          localNode.agents = [{ agentId: DEFAULT_LOCAL_AGENT_ID, connId: "" }, ...localNode.agents];
        }
      } else {
        nodes = [
          { nodeId: localHostname, deviceId: localHostname, connId: "", agents: [{ agentId: DEFAULT_LOCAL_AGENT_ID, connId: "" }] },
          ...nodes,
        ];
      }
      return ok({
        nodes: nodes.map((n) => ({
          nodeId: n.nodeId,
          deviceId: n.deviceId,
          connId: n.connId,
          agents: n.agents,
          ...(n.capabilities?.length ? { capabilities: n.capabilities } : {}),
        })),
        connectors: connectors.map((c) => ({
          connectorId: c.connectorId,
          connId: c.connId,
          online: c.online,
          displayName: c.displayName,
        })),
      });
    },

    "node.invoke": async (params: Record<string, unknown>): Promise<GatewayResponse> => {
      const nodeId = params?.nodeId as string | undefined;
      if (typeof nodeId !== "string") return fail(err(INVALID_REQUEST, "node.invoke requires params.nodeId"));
      const nodes = getNodesFromConnections(connections);
      const node = nodes.find((n) => n.nodeId === nodeId || n.deviceId === nodeId || n.connId === nodeId);
      if (!node) return fail(err(NOT_FOUND, `node not found: ${nodeId}`));
      const entry = connections.get(node.connId);
      if (!entry || entry.ws.readyState !== 1) return fail(err(503, "node not connected"));
      const id = nextInvokeId();
      const payload = { id, ...params };
      return new Promise<GatewayResponse>((resolve) => {
        const timeout = setTimeout(() => {
          if (pendingInvokes.delete(id)) resolve(fail(err(504, "node.invoke timeout")));
        }, 60_000);
        pendingInvokes.set(id, (result: unknown) => {
          clearTimeout(timeout);
          pendingInvokes.delete(id);
          resolve(ok({ id, result }));
        });
        entry.ws.send(JSON.stringify({ event: "node.invoke.request", payload }));
      });
    },

    "node.invoke.result": async (params: Record<string, unknown>): Promise<GatewayResponse> => {
      const id = params?.id;
      if (id == null) return fail(err(INVALID_REQUEST, "node.invoke.result requires params.id"));
      const resolveFn = pendingInvokes.get(String(id));
      if (resolveFn) {
        pendingInvokes.delete(String(id));
        resolveFn(params?.result ?? params);
      }
      return ok({ id, accepted: true });
    },

    "connector.mapping.list": async (): Promise<GatewayResponse> => {
      return ok({ mappings: [...connectorMappings] });
    },

    "connector.mapping.add": async (params: Record<string, unknown>): Promise<GatewayResponse> => {
      const connectorId = params?.connectorId as string | undefined;
      const agentId = params?.agentId as string | undefined;
      if (typeof connectorId !== "string" || typeof agentId !== "string") {
        return fail(err(INVALID_REQUEST, "connector.mapping.add requires params.connectorId and params.agentId"));
      }
      const mapping: ConnectorMapping = {
        id: nextMappingId(),
        connectorId,
        channelId: typeof params?.channelId === "string" ? params.channelId : undefined,
        agentId,
        nodeId: typeof params?.nodeId === "string" ? params.nodeId : undefined,
        deviceId: typeof params?.deviceId === "string" ? params.deviceId : undefined,
      };
      connectorMappings.push(mapping);
      await persistConnectorMappings?.();
      return ok(mapping);
    },

    "connector.mapping.remove": async (params: Record<string, unknown>): Promise<GatewayResponse> => {
      const id = params?.id as string | undefined;
      if (typeof id !== "string") return fail(err(INVALID_REQUEST, "connector.mapping.remove requires params.id"));
      const idx = connectorMappings.findIndex((m) => m.id === id);
      if (idx === -1) return fail(err(NOT_FOUND, `mapping not found: ${id}`));
      const [removed] = connectorMappings.splice(idx, 1);
      await persistConnectorMappings?.();
      return ok({ id: removed.id, removed: true });
    },

    "connector.mapping.resolve": async (params: Record<string, unknown>): Promise<GatewayResponse> => {
      const connectorId = params?.connectorId as string | undefined;
      const channelId = params?.channelId as string | undefined;
      if (typeof connectorId !== "string") {
        return fail(err(INVALID_REQUEST, "connector.mapping.resolve requires params.connectorId"));
      }
      const mapping = channelId
        ? connectorMappings.find((m) => m.connectorId === connectorId && m.channelId === channelId)
        : connectorMappings.find((m) => m.connectorId === connectorId);
      if (!mapping) return ok({ agentId: undefined, nodeId: undefined, deviceId: undefined });
      return ok({
        agentId: mapping.agentId,
        nodeId: mapping.nodeId,
        deviceId: mapping.deviceId,
        mappingId: mapping.id,
      });
    },

    "connector.message.inbound": async (params: Record<string, unknown>): Promise<GatewayResponse> => {
      const connectorId = (params?.connectorId as string)?.trim();
      const chatId = (params?.chatId as string)?.trim();
      const text = typeof params?.text === "string" ? params.text : String(params?.text ?? "");
      if (!connectorId || !chatId) {
        return fail(err(INVALID_REQUEST, "connector.message.inbound requires params.connectorId and params.chatId"));
      }
      const channelId = typeof params?.channelId === "string" ? params.channelId.trim() : undefined;
      const messageId = typeof params?.messageId === "string" ? params.messageId : undefined;

      const sessionKey = `connector:${connectorId}:chat:${chatId}`;
      const store = loadSessionStore(sessionStorePath, { skipCache: true });
      const resolveOpts = { storePath: sessionStorePath, resetPolicy };
      const resolved = resolveSession(store, { sessionKey }, mainTranscriptPath, resolveOpts);
      const { entry: sessionEntry, transcriptPath, sessionKey: resolvedKey } = resolved;

      const matchSwitch = (t: string): string | null => {
        const s = t.trim();
        const m1 = /^\/agent\s+(.+)$/i.exec(s);
        if (m1) return m1[1].trim();
        const m2 = /^(与|和)\s*(.+?)\s*对话\s*$/.exec(s);
        if (m2) return m2[2].trim();
        const m3 = /^切换(至|到)?\s*(.+)$/.exec(s);
        if (m3) return m3[2].trim();
        return null;
      };
      const switchTarget = matchSwitch(text);
      if (switchTarget !== null) {
        updateSessionEntry(sessionStorePath, resolvedKey, {
          agentIdOverride: switchTarget,
          updatedAt: Date.now(),
        });
        return ok({
          replyText: `已切换到 ${switchTarget}，后续消息将由此 Agent 回复。输入「与 .u 对话」或「/agent .u」可切回默认。`,
          runId: undefined,
        });
      }

      const mapping = channelId
        ? connectorMappings.find((m) => m.connectorId === connectorId && m.channelId === channelId)
        : connectorMappings.find((m) => m.connectorId === connectorId);
      const agentId = sessionEntry?.agentIdOverride ?? mapping?.agentId ?? DEFAULT_LOCAL_AGENT_ID;
      const message = text || "(无文本)";

      if (ctx.sessionQueue && isSessionActive(ctx.sessionQueue, resolvedKey)) {
        enqueue(ctx.sessionQueue, resolvedKey, message);
        return ok({ queued: true });
      }

      // 任意 agentId（含默认 .u）优先走已连接 agent 的 node.invoke.request
      const nodes = getNodesFromConnections(connections);
      const node = nodes.find((n) => n.agents.some((a) => a.agentId === agentId));
      const remoteEntry = node ? connections.get(node.connId) : undefined;
      if (remoteEntry?.ws.readyState === 1) {
        const id = nextInvokeId();
        if (ctx.sessionQueue) setActiveRun(ctx.sessionQueue, resolvedKey, id);
        const runOneTurnRemoteInbound = async (sk: string, msg: string): Promise<void> => {
          const st = loadSessionStore(sessionStorePath);
          const res = resolveSession(st, { sessionKey: sk }, mainTranscriptPath, resolveOpts);
          const rkey = res.sessionKey;
          const n = getNodesFromConnections(connections);
          const no = n.find((nn) => nn.agents.some((a) => a.agentId === agentId));
          const ent = no ? connections.get(no.connId) : undefined;
          if (!ent || ent.ws.readyState !== 1) return;
          const invId = nextInvokeId();
          if (ctx.sessionQueue) setActiveRun(ctx.sessionQueue, rkey, invId);
          await new Promise<void>((resolvePromise) => {
            const timeout = setTimeout(() => {
              if (pendingInvokes.delete(invId)) {
                if (ctx.sessionQueue) clearActiveRunByRunId(ctx.sessionQueue, invId);
                resolvePromise();
              }
            }, 120_000);
            pendingInvokes.set(invId, (result: unknown) => {
              clearTimeout(timeout);
              pendingInvokes.delete(invId);
              if (ctx.sessionQueue) {
                clearActiveRunByRunId(ctx.sessionQueue, invId);
                onRunComplete(ctx.sessionQueue, rkey, (merged) => runOneTurnRemoteInbound(rkey, merged));
              }
              resolvePromise();
            });
            ent.ws.send(JSON.stringify({ event: "node.invoke.request", payload: { id: invId, __agent: true, message: msg, sessionKey: sk } }));
          });
        };
        return new Promise<GatewayResponse>((resolve) => {
          const timeout = setTimeout(() => {
            if (pendingInvokes.delete(id)) {
              if (ctx.sessionQueue) clearActiveRunByRunId(ctx.sessionQueue, id);
              resolve(fail(err(504, "connector inbound agent timeout")));
            }
          }, 120_000);
          pendingInvokes.set(id, (result: unknown) => {
            clearTimeout(timeout);
            pendingInvokes.delete(id);
            const out = typeof result === "object" && result !== null && "text" in result ? (result as { text: string }) : { text: String(result) };
            if (ctx.sessionQueue) {
              clearActiveRunByRunId(ctx.sessionQueue, id);
              onRunComplete(ctx.sessionQueue, resolvedKey, (merged) => runOneTurnRemoteInbound(resolvedKey, merged));
            }
            resolve(ok({ replyText: out.text, runId: id }));
          });
          remoteEntry.ws.send(JSON.stringify({ event: "node.invoke.request", payload: { id, __agent: true, message, sessionKey } }));
        });
      }

      if (agentId !== DEFAULT_LOCAL_AGENT_ID && (mapping || sessionEntry?.agentIdOverride)) {
        return fail(err(503, `agent ${agentId} not connected (请确保该 Agent 已连上 Gateway)`));
      }
      if (!ctx.runAgent) {
        return fail(err(501, "agent run not configured. 请先启动 agent（例如 npm run agent）并连接本 Gateway。"));
      }
      const runOneTurnLocalInbound = async (sk: string, msg: string): Promise<void> => {
        const st = loadSessionStore(sessionStorePath);
        const res = resolveSession(st, { sessionKey: sk }, mainTranscriptPath, resolveOpts);
        const tpath = res.transcriptPath;
        const rkey = res.sessionKey;
        const runId = nextRunId();
        if (ctx.sessionQueue) setActiveRun(ctx.sessionQueue, rkey, runId);
        try {
          const result = await ctx.runAgent!(ctx.rootDir, msg, { transcriptPath: tpath, leafId: res.entry?.leafId ?? undefined });
          const patch: { updatedAt: number; leafId?: string } = { updatedAt: Date.now() };
          if (result.newLeafId != null) patch.leafId = result.newLeafId;
          updateSessionEntry(sessionStorePath, rkey, patch);
        } finally {
          if (ctx.sessionQueue) {
            clearActiveRunByRunId(ctx.sessionQueue, runId);
            onRunComplete(ctx.sessionQueue, rkey, (merged) => runOneTurnLocalInbound(rkey, merged));
          }
        }
      };
      const runId = nextRunId();
      const controller = new AbortController();
      runIdToAbort.set(runId, controller);
      if (ctx.sessionQueue) setActiveRun(ctx.sessionQueue, resolvedKey, runId);
      const promise = new Promise<{ text: string; toolCalls?: Array<{ name: string; arguments?: string }> }>((resolve, reject) => {
        inFlightAgentRuns.set(runId, { resolve: resolve as (r: unknown) => void, reject });
      });
      runIdToPromise.set(runId, promise);

      try {
        const result = await ctx.runAgent!(ctx.rootDir, message, {
          transcriptPath,
          leafId: sessionEntry?.leafId ?? undefined,
          signal: controller.signal,
        });
        const patch: { updatedAt: number; leafId?: string } = { updatedAt: Date.now() };
        if (result.newLeafId != null) patch.leafId = result.newLeafId;
        updateSessionEntry(sessionStorePath, resolvedKey, patch);
        inFlightAgentRuns.delete(runId);
        runIdToAbort.delete(runId);
        runIdToPromise.delete(runId);
        if (ctx.sessionQueue) {
          clearActiveRunByRunId(ctx.sessionQueue, runId);
          onRunComplete(ctx.sessionQueue, resolvedKey, (merged) => runOneTurnLocalInbound(resolvedKey, merged));
        }
        return ok({ replyText: result.text, runId });
      } catch (e) {
        inFlightAgentRuns.delete(runId);
        runIdToAbort.delete(runId);
        runIdToPromise.delete(runId);
        if (ctx.sessionQueue) clearActiveRunByRunId(ctx.sessionQueue, runId);
        return fail(err(500, (e as Error).message));
      }
    },

    "connector.message.push": async (params: Record<string, unknown>): Promise<GatewayResponse> => {
      const connectorId = (params?.connectorId as string)?.trim();
      const chatId = (params?.chatId as string)?.trim();
      const text = typeof params?.text === "string" ? params.text : String(params?.text ?? "");
      if (!connectorId || !chatId) {
        return fail(err(INVALID_REQUEST, "connector.message.push requires params.connectorId and params.chatId"));
      }
      const connectors = getConnectorsFromConnections(connections);
      if (!connectors.some((c) => c.connectorId === connectorId)) {
        return fail(err(503, `connector ${connectorId} not connected`));
      }
      if (!ctx.pushToConnector) {
        return fail(err(501, "pushToConnector not configured"));
      }
      const payload = {
        connectorId,
        chatId,
        channelId: typeof params?.channelId === "string" ? params.channelId : undefined,
        text,
        attachments: Array.isArray(params?.attachments) ? params.attachments : undefined,
        replyToId: typeof params?.replyToId === "string" ? params.replyToId : undefined,
      };
      ctx.pushToConnector(connectorId, "connector.message.push", payload);
      return ok({ pushed: true });
    },
  };
}

export type GatewayHandlers = ReturnType<typeof createHandlers>;

/** 供本机 runAgentTurn 注入：Agent 内 message_skill、sessions_skill 可调用的 Gateway RPC 封装 */
export function createGatewayInvoke(
  handlers: GatewayHandlers,
): (method: string, params: Record<string, unknown>) => Promise<unknown> {
  return async (method: string, params: Record<string, unknown>) => {
    const fn = (handlers as Record<string, (p: Record<string, unknown>) => Promise<GatewayResponse>>)[method];
    if (typeof fn !== "function") throw new Error(`Unknown method: ${method}`);
    const res = await fn(params);
    if (!res.ok) {
      const errMsg = (res as { error?: { message?: string } }).error?.message ?? "Gateway error";
      throw new Error(errMsg);
    }
    return (res as { payload: unknown }).payload;
  };
}
