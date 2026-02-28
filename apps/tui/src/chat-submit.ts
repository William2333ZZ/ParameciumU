/**
 * 提交输入路由：与 OpenClaw 一致，/ 命令、! shell、普通消息。
 * 抽离以便单元测试。
 */
export type SubmitAction =
	| { type: "help" }
	| { type: "clear" }
	| { type: "cron" }
	| { type: "unknown_cmd"; raw: string }
	| { type: "bang"; cmd: string }
	| { type: "message"; value: string };

/**
 * 解析用户提交的一行输入，返回应执行的动作。
 * - 空/仅空白：返回 null（调用方应忽略）
 * - 以 / 开头：help / clear / cron 或 unknown_cmd
 * - 以 ! 开头且非单独 "!"：bang
 * - 单独 "!" 或其它：message（value 为 trim 后，bang 时保留原始 raw 给 shell）
 */
export function getSubmitAction(raw: string): SubmitAction | null {
	const value = raw.trim();
	if (!value) return null;

	if (value.startsWith("/")) {
		if (value === "/help" || value.startsWith("/help ")) return { type: "help" };
		if (value === "/clear" || value.startsWith("/clear ")) return { type: "clear" };
		if (value === "/cron" || value.startsWith("/cron ")) return { type: "cron" };
		return { type: "unknown_cmd", raw: value };
	}

	if (raw.startsWith("!") && raw !== "!") {
		const cmd = raw.slice(1).trim();
		return { type: "bang", cmd };
	}

	return { type: "message", value };
}
