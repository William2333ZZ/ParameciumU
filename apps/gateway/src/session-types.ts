/**
 * Session 类型：与 OpenClaw 的 SessionEntry 对齐的极简子集。
 * store 为 sessionKey -> SessionEntry 的 map。
 */

export type SessionEntry = {
	sessionId: string;
	updatedAt: number;
	/** 当前叶节点 entry id（树形 transcript 下生效，省略表示线性或未初始化） */
	leafId?: string | null;
	/** 可选：transcript 文件路径（默认在 .gateway/sessions/transcripts/ 下） */
	transcriptPath?: string;
	/** 可选：展示名 */
	displayName?: string;
	/** 可选：channel 标识 */
	channel?: string;
	/** 可选：上下文 token 数（agent 执行后回写） */
	contextTokens?: number;
	/** 可选：总 token 数 */
	totalTokens?: number;
	/** 可选：模型标识 */
	model?: string;
	/** 可选：思考级别 */
	thinkingLevel?: string;
	/** 可选：发送策略覆盖 allow | deny */
	sendPolicy?: "allow" | "deny";
	/** 可选：该会话指定使用的 agent（connector 入站时可由用户切换，如「与 pilot 对话」） */
	agentIdOverride?: string;
};

export type SessionStore = Record<string, SessionEntry>;
