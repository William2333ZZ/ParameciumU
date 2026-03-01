/**
 * Gateway skill: complete toolset for interacting with the monoU Gateway.
 *
 * Covers:
 *   - Topology discovery: agents.list / node.list
 *   - Capability & cron queries: skills.status / cron.list
 *   - Agent delegation: chat.send to another agent's session
 *   - Node invocation: node.invoke (call browser-node / sandbox-node — MCP-style)
 *   - Session management: sessions.list / sessions.preview / chat.send to session
 *   - Message push: connector.message.push (e.g. Feishu)
 *
 * Architecture note:
 *   L3 Nodes (browser-node, sandbox-node) connect with role=node and declare
 *   capabilities (e.g. ["browser"], ["sandbox"]) on connect. Agents call their
 *   commands via gateway_node_invoke → node.invoke on the Gateway — analogous
 *   to MCP servers. Skills files do NOT expose node capabilities.
 */

import type { AgentTool } from "@monou/agent-core";

export const tools: AgentTool[] = [
  // ── Topology discovery ──────────────────────────────────────
  {
    name: "gateway_agents_list",
    description:
      "List all agents currently connected to the Gateway (agentId, deviceId, online, lastHeartbeatAt).",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "gateway_nodes_list",
    description:
      "List Gateway topology: L3 nodes (nodeId, deviceId, capabilities such as browser/sandbox) and L1 connectors (e.g. Feishu). Nodes expose capabilities via node.invoke.",
    parameters: { type: "object", properties: {}, required: [] },
  },

  // ── Skills & cron queries ───────────────────────────────────
  {
    name: "gateway_cron_list",
    description:
      "List scheduled jobs for an agent. Optional agentId (defaults to current agent). Returns name, schedule, nextRunAtMs, enabled.",
    parameters: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "Agent ID; defaults to current agent." },
        includeDisabled: {
          type: "boolean",
          description: "Include disabled jobs; defaults to true.",
        },
      },
      required: [],
    },
  },
  {
    name: "gateway_skills_status",
    description:
      "Get the skills/capabilities of an agent (what it can do). Optional agentId, defaults to current agent. Returns skill names and summaries.",
    parameters: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "Agent ID; defaults to current agent." },
      },
      required: [],
    },
  },

  // ── Agent delegation ────────────────────────────────────────
  {
    name: "gateway_agent_send_to_session",
    description:
      "Send a message to another agent's session; that agent executes and replies directly in that session (delegation). Required: targetAgentId, message. Optional sessionKey (defaults to agent:<targetAgentId>:main). Check gateway_agents_list first to confirm the target is online.",
    parameters: {
      type: "object",
      properties: {
        targetAgentId: { type: "string", description: "Target agent's agentId (required)." },
        message: { type: "string", description: "Message to send (required)." },
        sessionKey: {
          type: "string",
          description: "Target sessionKey; defaults to agent:<targetAgentId>:main.",
        },
      },
      required: ["targetAgentId", "message"],
    },
  },

  // ── Node invocation (browser-node / sandbox-node) ───────────
  {
    name: "gateway_node_invoke",
    description:
      "Invoke a command on an L3 node (browser-node, sandbox-node, etc.) — MCP-style. First use gateway_nodes_list to find nodeId and capabilities. browser-node commands: browser_fetch, browser_click, browser_fill, browser_links, browser_screenshot, browser_pages, browser_switch, browser_new_tab. sandbox-node commands: system.run, system.which.",
    parameters: {
      type: "object",
      properties: {
        nodeId: { type: "string", description: "Target node ID (from gateway_nodes_list)." },
        command: {
          type: "string",
          description:
            "Node command, e.g. browser_fetch, browser_click, browser_fill, browser_links, system.run, system.which.",
        },
        params: {
          type: "object",
          description: "Parameters for the command (varies by command; e.g. browser_fetch requires url).",
        },
      },
      required: ["nodeId", "command"],
    },
  },

  // ── Session management ──────────────────────────────────────
  {
    name: "sessions_list",
    description:
      "List all sessions for the current agent (sessionKey, sessionId, updatedAt, displayName).",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "sessions_preview",
    description:
      "List sessions with minimal fields (sessionKey, updatedAt, displayName) for a quick overview.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "sessions_send",
    description:
      "Send a message to a session by sessionKey; triggers the agent to run and reply in that session.",
    parameters: {
      type: "object",
      properties: {
        sessionKey: {
          type: "string",
          description: "Session key, e.g. main or connector:feishu:chat:xxx.",
        },
        message: { type: "string", description: "Message content to send." },
      },
      required: ["sessionKey", "message"],
    },
  },

  // ── Message push ────────────────────────────────────────────
  {
    name: "send_message",
    description:
      "Push a message to a connector channel (e.g. Feishu group or DM). Get connectorId from gateway_nodes_list connectors. Required: connectorId, chatId, text.",
    parameters: {
      type: "object",
      properties: {
        connectorId: {
          type: "string",
          description: "Connector ID (e.g. Feishu connector's connectorId, from gateway_nodes_list).",
        },
        chatId: { type: "string", description: "Chat / group / DM ID." },
        text: { type: "string", description: "Text to send." },
        channelId: { type: "string", description: "Optional sub-channel ID." },
      },
      required: ["connectorId", "chatId", "text"],
    },
  },
];

export type GatewayInvoke = (method: string, params: Record<string, unknown>) => Promise<unknown>;

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  gatewayInvoke?: GatewayInvoke,
): Promise<{ content: string; isError?: boolean }> {
  if (!gatewayInvoke) {
    return {
      content: "Gateway tools require a Gateway connection (not available in this run).",
      isError: true,
    };
  }
  try {
    // ── Topology discovery ────────────────────────────────────
    if (name === "gateway_agents_list") {
      const result = await gatewayInvoke("agents.list", {});
      const payload =
        result && typeof result === "object" && "agents" in result
          ? (result as { agents: unknown[] }).agents
          : result;
      return { content: JSON.stringify(payload, null, 2) };
    }

    if (name === "gateway_nodes_list") {
      const result = await gatewayInvoke("node.list", {});
      return { content: JSON.stringify(result, null, 2) };
    }

    // ── Skills & cron queries ─────────────────────────────────
    if (name === "gateway_cron_list") {
      const agentId = (args?.agentId as string)?.trim() || ".u";
      const includeDisabled = args?.includeDisabled !== false;
      const result = await gatewayInvoke("cron.list", { agentId, includeDisabled });
      const payload =
        result && typeof result === "object" && "jobs" in result
          ? (result as { jobs: unknown[] }).jobs
          : result;
      return { content: JSON.stringify(payload, null, 2) };
    }

    if (name === "gateway_skills_status") {
      const agentId = (args?.agentId as string)?.trim() || ".u";
      const result = await gatewayInvoke("skills.status", { agentId });
      return { content: JSON.stringify(result, null, 2) };
    }

    // ── Agent delegation ──────────────────────────────────────
    if (name === "gateway_agent_send_to_session") {
      const targetAgentId = (args?.targetAgentId as string)?.trim();
      const message = (args?.message as string)?.trim();
      if (!targetAgentId || !message) {
        return {
          content: "gateway_agent_send_to_session requires targetAgentId and message.",
          isError: true,
        };
      }
      const sessionKey =
        (args?.sessionKey as string)?.trim() || `agent:${targetAgentId}:main`;
      const result = await gatewayInvoke("chat.send", {
        agentId: targetAgentId,
        sessionKey,
        message,
      });
      return { content: JSON.stringify(result, null, 2) };
    }

    // ── Node invocation ───────────────────────────────────────
    if (name === "gateway_node_invoke") {
      const nodeId = (args?.nodeId as string)?.trim();
      const command = (args?.command as string)?.trim();
      if (!nodeId || !command) {
        return { content: "gateway_node_invoke requires nodeId and command.", isError: true };
      }
      const params =
        args?.params && typeof args.params === "object"
          ? (args.params as Record<string, unknown>)
          : {};
      const result = await gatewayInvoke("node.invoke", { nodeId, command, params });
      return { content: JSON.stringify(result, null, 2) };
    }

    // ── Session management ────────────────────────────────────
    if (name === "sessions_list") {
      const result = await gatewayInvoke("sessions.list", {});
      const payload =
        result && typeof result === "object" && "sessions" in result
          ? (result as { sessions: unknown[] }).sessions
          : result;
      return { content: JSON.stringify(payload, null, 2) };
    }

    if (name === "sessions_preview") {
      const result = await gatewayInvoke("sessions.preview", {});
      const payload =
        result && typeof result === "object" && "sessions" in result
          ? (result as { sessions: unknown[] }).sessions
          : result;
      return { content: JSON.stringify(payload, null, 2) };
    }

    if (name === "sessions_send") {
      const sessionKey = String(args.sessionKey ?? "").trim();
      const message = String(args.message ?? "").trim();
      if (!sessionKey || !message) {
        return { content: "sessionKey and message are required.", isError: true };
      }
      const result = await gatewayInvoke("chat.send", { sessionKey, message });
      return { content: JSON.stringify(result, null, 2) };
    }

    // ── Message push ──────────────────────────────────────────
    if (name === "send_message") {
      const connectorId = String(args.connectorId ?? "").trim();
      const chatId = String(args.chatId ?? "").trim();
      const text = String(args.text ?? "").trim();
      if (!connectorId || !chatId) {
        return { content: "connectorId and chatId are required.", isError: true };
      }
      const result = await gatewayInvoke("connector.message.push", {
        connectorId,
        chatId,
        text: text || "(empty)",
        ...(typeof args.channelId === "string" &&
          args.channelId.trim() && { channelId: args.channelId.trim() }),
      });
      const ok =
        result &&
        typeof result === "object" &&
        "pushed" in result &&
        (result as { pushed?: boolean }).pushed === true;
      return ok
        ? { content: "Message sent." }
        : { content: JSON.stringify(result), isError: true };
    }

    return { content: `Unknown tool: ${name}`, isError: true };
  } catch (e) {
    return { content: e instanceof Error ? e.message : String(e), isError: true };
  }
}
