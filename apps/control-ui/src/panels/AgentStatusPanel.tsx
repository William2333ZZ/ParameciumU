import { useEffect, useMemo, useRef, useState } from "react";
import { gatewayClient } from "../gateway-client";
import idleSprite from "../assets/agent-idle-sprite.svg";
import writingSprite from "../assets/agent-writing-sprite.svg";
import researchingSprite from "../assets/agent-researching-sprite.svg";
import executingSprite from "../assets/agent-executing-sprite.svg";
import syncingSprite from "../assets/agent-syncing-sprite.svg";
import offlineSprite from "../assets/agent-offline-sprite.svg";
import fallbackSprite from "../assets/agent-sprite.svg";

type AgentMood = "idle" | "writing" | "researching" | "executing" | "syncing" | "offline";
type StageAgent = { agentId: string; mood: AgentMood; updatedAt: number; bubble: string; online: boolean };
type NodeListPayload = {
  nodes?: Array<{ agents?: Array<{ agentId: string; lastHeartbeatAt?: number }> }>;
};

const STATE_INFO: Record<AgentMood, { label: string; flavor: string; sprite: string }> = {
  idle: { label: "待命", flavor: "随时可接任务", sprite: idleSprite },
  writing: { label: "写作中", flavor: "输出整理中", sprite: writingSprite },
  researching: { label: "检索中", flavor: "查证信息中", sprite: researchingSprite },
  executing: { label: "执行中", flavor: "工具调用中", sprite: executingSprite },
  syncing: { label: "同步中", flavor: "结果对齐中", sprite: syncingSprite },
  offline: { label: "离线", flavor: "等待连接恢复", sprite: offlineSprite },
};

const BUBBLES: Record<AgentMood, string[]> = {
  idle: ["喵，今天也保持高效", "待命中，准备接任务", "先观察，再出手"],
  writing: ["正在整理输出结构", "把复杂问题拆成块", "先写最小可行版本"],
  researching: ["搜索证据链中", "我在交叉验证信息", "快定位到关键线索了"],
  executing: ["执行开始，保持专注", "推进中，请稍候", "正在串联工具链路"],
  syncing: ["同步会话上下文", "正在落盘结果", "最后一步，马上完成"],
  offline: ["当前离线，等你重新连接", "网络中断，状态冻结", "连接恢复后继续工作"],
};

function pickBubble(state: AgentMood): string {
  const texts = BUBBLES[state];
  return texts[Math.floor(Math.random() * texts.length)] ?? "";
}

function parseAgentId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as { agentId?: unknown; sessionKey?: unknown };
  if (typeof p.agentId === "string" && p.agentId.trim()) return p.agentId.trim();
  if (typeof p.sessionKey === "string") {
    const m = /^agent:([^:]+):/.exec(p.sessionKey);
    if (m?.[1]) return m[1];
  }
  return null;
}

export function AgentStatusPanel() {
  const [agents, setAgents] = useState<Record<string, StageAgent>>({});
  const runOwnerRef = useRef<Record<string, string>>({});
  const lastTouchedAgentRef = useRef<string | null>(null);

  useEffect(() => {
    const onlineThresholdMs = 90_000;
    const setMoodForAgent = (agentId: string, mood: AgentMood) => {
      if (!agentId) return;
      lastTouchedAgentRef.current = agentId;
      setAgents((prev) => {
        const old = prev[agentId];
        const online = old ? old.online : mood !== "offline";
        return {
          ...prev,
          [agentId]: {
            agentId,
            mood,
            bubble: pickBubble(mood),
            updatedAt: Date.now(),
            online,
          },
        };
      });
    };

    const refreshAgents = () => {
      gatewayClient
        .request<NodeListPayload>("node.list")
        .then((res) => {
          if (!res.ok || !res.payload?.nodes) return;
          const nextMap = new Map<string, boolean>();
          const now = Date.now();
          for (const n of res.payload.nodes) {
            for (const a of n.agents ?? []) {
              const online = a.lastHeartbeatAt != null && now - a.lastHeartbeatAt < onlineThresholdMs;
              const prevOnline = nextMap.get(a.agentId);
              nextMap.set(a.agentId, Boolean(prevOnline || online));
            }
          }
          setAgents((prev) => {
            const merged: Record<string, StageAgent> = {};
            for (const [agentId, online] of nextMap) {
              const old = prev[agentId];
              const oldMood = old?.mood;
              const mood: AgentMood = online ? (oldMood === "offline" || !oldMood ? "idle" : oldMood) : "offline";
              merged[agentId] = {
                agentId,
                mood,
                online,
                bubble: old?.bubble ?? pickBubble(mood),
                updatedAt: old?.updatedAt ?? now,
              };
            }
            return merged;
          });
        })
        .catch(() => {});
    };
    refreshAgents();
    const poll = window.setInterval(refreshAgents, 5000);

    const resolveAgentFromPayload = (payload: unknown): string | null => {
      const direct = parseAgentId(payload);
      if (direct) return direct;
      if (payload && typeof payload === "object") {
        const runId = (payload as { runId?: unknown }).runId;
        if (typeof runId === "string" && runOwnerRef.current[runId]) return runOwnerRef.current[runId];
      }
      return lastTouchedAgentRef.current;
    };

    const unStarted = gatewayClient.onEvent("agent.run.started", (payload: unknown) => {
      const aid = resolveAgentFromPayload(payload);
      if (payload && typeof payload === "object") {
        const runId = (payload as { runId?: unknown }).runId;
        if (typeof runId === "string" && aid) runOwnerRef.current[runId] = aid;
      }
      if (aid) setMoodForAgent(aid, "executing");
    });
    const unChunk = gatewayClient.onEvent("agent.run.chunk", (payload: unknown) => {
      const aid = resolveAgentFromPayload(payload);
      if (aid) setMoodForAgent(aid, "writing");
    });
    const unProgress = gatewayClient.onEvent("agent.run.progress", (payload: unknown) => {
      const aid = resolveAgentFromPayload(payload);
      if (aid) setMoodForAgent(aid, "researching");
    });
    const unToolCall = gatewayClient.onEvent("agent.run.tool_call", (payload: unknown) => {
      const aid = resolveAgentFromPayload(payload);
      if (aid) setMoodForAgent(aid, "executing");
    });
    const unDone = gatewayClient.onEvent("agent.run.done", () => {
      const aid = resolveAgentFromPayload(null);
      if (!aid) return;
      setMoodForAgent(aid, "syncing");
      window.setTimeout(() => {
        setMoodForAgent(aid, "idle");
      }, 1400);
    });

    return () => {
      unStarted();
      unChunk();
      unProgress();
      unToolCall();
      unDone();
      window.clearInterval(poll);
    };
  }, []);

  const stageAgents = useMemo(
    () =>
      Object.values(agents)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 12),
    [agents]
  );
  const onlineCount = stageAgents.filter((a) => a.online).length;

  return (
    <section className="agent-status-card">
      <div className="agent-status-header">
        <span className="agent-status-dot agent-status-dot--idle" />
        <span className="agent-status-title">多 Agent 办公区</span>
      </div>
      <div className="agent-status-stage">
        {stageAgents.length === 0 ? (
          <div className="agent-status-empty">暂无在线 Agent</div>
        ) : (
          <div className="agent-squad-grid">
            {stageAgents.map((a) => {
              const info = STATE_INFO[a.mood] ?? { label: "待命", flavor: "", sprite: fallbackSprite };
              return (
                <article key={a.agentId} className="agent-squad-item">
                  <div className={`agent-status-sprite-wrap agent-status-sprite-wrap--${a.mood}`} aria-label={`${a.agentId}-${a.mood}`}>
                    <div className="agent-status-sprite-window">
                      <img
                        className={`agent-status-sprite-strip agent-status-sprite-strip--${a.mood}`}
                        src={info.sprite || fallbackSprite}
                        alt={`${a.agentId}-${a.mood}`}
                      />
                    </div>
                  </div>
                  <div className="agent-squad-name" title={a.agentId}>{a.agentId}</div>
                  <div className="agent-squad-state">{info.label}</div>
                </article>
              );
            })}
          </div>
        )}
      </div>
      <div className="agent-status-meta">
        <div className="agent-status-line">
          <span className="agent-status-label">在线 / 总数</span>
          <span className="agent-status-value">{onlineCount} / {stageAgents.length}</span>
        </div>
        <p className="agent-status-flavor">无主角色。每个 Agent 按自己的实时状态独立动画。</p>
      </div>
    </section>
  );
}
