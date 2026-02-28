/**
 * 在 Gateway 进程内跑一轮 agent：buildSessionFromU + runAgentTurnWithTools。
 * 支持按 transcriptPath 加载/保存对话历史（多会话持久化）。
 *
 * @param rootDir 工作区根目录（其下 .u 为 agent 目录），或当 opts.agentDir 存在时仅作占位
 * @param opts.agentDir 若指定，则直接作为 agent 目录（与 .u 同构：其下 cron/、skills/ 等）
 * @param opts.transcriptPath 若指定，则从该路径加载历史、跑完后写回（实现 session 持久化）
 */

import type { AgentMessage } from "@monou/agent-sdk";
import { runAgentTurnWithTools, runAgentTurnWithToolsStreaming } from "@monou/agent-sdk";
import { createId } from "@monou/shared";
import { buildSessionFromU, createAgentContextFromU } from "@monou/agent-from-dir";
import type { StoredMessage } from "./session-transcript.js";
import { appendTranscriptMessages, loadTranscript } from "./session-transcript.js";

function storedToAgentMessages(stored: StoredMessage[]): AgentMessage[] {
  return stored.map((s) => {
    const id = createId();
    const content = (s.content ?? "").trim() || " ";
    if (s.role === "toolResult") {
      return {
        id,
        role: "toolResult" as const,
        content: [{ type: "text" as const, text: content }],
        timestamp: Date.now(),
        toolCallId: s.toolCallId ?? id,
        isError: s.isError ?? false,
      };
    }
    if (s.role === "assistant") {
      return {
        id,
        role: "assistant" as const,
        content: [{ type: "text" as const, text: content }],
        timestamp: Date.now(),
        ...(s.toolCalls?.length && { toolCalls: s.toolCalls }),
      };
    }
    if (s.role === "system") {
      return {
        id,
        role: "system" as const,
        content: [{ type: "text" as const, text: content }],
        timestamp: Date.now(),
      };
    }
    return {
      id,
      role: "user" as const,
      content: [{ type: "text" as const, text: content }],
      timestamp: Date.now(),
    };
  });
}

function agentMessagesToStored(messages: AgentMessage[]): StoredMessage[] {
  return messages.map((m) => {
    const text =
      m.content?.find((c) => c.type === "text") && (m.content as { type: "text"; text: string }[])[0]?.text;
    const content = typeof text === "string" ? text : "";
    if (m.role === "toolResult") {
      return {
        role: "toolResult",
        content,
        toolCallId: m.toolCallId,
        isError: m.isError,
      };
    }
    if (m.role === "assistant") {
      return {
        role: "assistant",
        content,
        ...(m.toolCalls?.length && { toolCalls: m.toolCalls }),
      };
    }
    if (m.role === "system") {
      return { role: "system", content };
    }
    return { role: "user", content };
  });
}

/** 供 message_skill、sessions_skill 调用的 Gateway RPC；由 Gateway 注入 */
export type GatewayInvokeFn = (method: string, params: Record<string, unknown>) => Promise<unknown>;

export async function runAgentTurn(
  rootDir: string,
  message: string,
  opts?: {
    agentDir?: string;
    transcriptPath?: string;
    /** 当前叶节点 id（树形 transcript）；省略则按单分支取最后一条 */
    leafId?: string | null;
    signal?: AbortSignal;
    /** 若提供，则使用流式执行并每收到一段文本调用一次，用于 UI 打字机效果 */
    onTextChunk?: (text: string) => void;
    /** 若提供，则 message_skill、sessions_skill 可调 Gateway RPC（connector.message.push、sessions.list、chat.send 等） */
    gatewayInvoke?: GatewayInvokeFn;
    /** 群聊时该条 assistant 的发送者 agentId，写入 transcript */
    senderAgentId?: string;
    /** 为 true 时只追加 assistant（及后续 tool 等），不追加首条 user；用于群聊「所有人回复」时第二人起仅追加自己的回复 */
    skipFirstUserInAppend?: boolean;
  },
): Promise<{
  text: string;
  toolCalls?: Array<{ name: string; arguments?: string }>;
  /** 本轮追加后的新叶节点 id，调用方应写回 SessionEntry.leafId */
  newLeafId?: string;
}> {
  const session = opts?.agentDir
    ? await buildSessionFromU(rootDir, { agentDir: opts.agentDir, gatewayInvoke: opts?.gatewayInvoke })
    : await buildSessionFromU(rootDir, { gatewayInvoke: opts?.gatewayInvoke });

  let initialMessages: AgentMessage[] | undefined;
  if (opts?.transcriptPath) {
    const stored = loadTranscript(opts.transcriptPath, opts?.leafId);
    initialMessages = storedToAgentMessages(stored);
  }

  const { state, config, streamFn } = createAgentContextFromU(session, {
    initialMessages,
  });
  const result =
    opts?.onTextChunk != null
      ? await runAgentTurnWithToolsStreaming(
          state,
          config,
          streamFn,
          message,
          session.executeTool,
          opts.signal,
          opts.onTextChunk,
        )
      : await runAgentTurnWithTools(
          state,
          config,
          streamFn,
          message,
          session.executeTool,
          opts?.signal,
        );

  let newLeafId: string | undefined;
  if (opts?.transcriptPath && initialMessages !== undefined) {
    let newMessages = result.state.messages.slice(initialMessages.length);
    if (opts?.skipFirstUserInAppend && newMessages.length > 0 && newMessages[0]?.role === "user") {
      newMessages = newMessages.slice(1);
    }
    if (newMessages.length > 0) {
      let toAppend = agentMessagesToStored(newMessages);
      if (opts.senderAgentId) {
        toAppend = toAppend.map((m) =>
          m.role === "assistant" ? { ...m, senderAgentId: opts.senderAgentId } : m,
        );
      }
      newLeafId = appendTranscriptMessages(
        opts.transcriptPath,
        opts.leafId ?? null,
        toAppend,
      );
    }
  }

  return {
    text: result.text,
    toolCalls: result.toolCalls?.map((t) => ({ name: t.name, arguments: t.arguments })),
    newLeafId,
  };
}
