/**
 * ChatLogArea 渲染测试 — 参考 pi / OpenClaw 的组件测试
 */
import { describe, expect, it } from "vitest";
import { ChatLogArea } from "./chat-log-area.js";

describe("ChatLogArea", () => {
	it("renders empty hint when no messages", () => {
		const area = new ChatLogArea();
		const lines = area.render(80);
		expect(lines.length).toBeGreaterThanOrEqual(1);
		expect(lines.some((l) => l.includes("输入消息开始对话") || l.includes("/help"))).toBe(true);
	});

	it("renders history label and user/assistant messages", () => {
		const area = new ChatLogArea();
		area.messages = [
			{ role: "user", content: "hello" },
			{ role: "assistant", content: "hi there" },
		];
		const lines = area.render(80);
		expect(lines.some((l) => l.includes("历史记录"))).toBe(true);
		expect(lines.some((l) => l.includes("hello"))).toBe(true);
		expect(lines.some((l) => l.includes("hi there"))).toBe(true);
	});

	it("renders system message", () => {
		const area = new ChatLogArea();
		area.messages = [{ role: "system", content: "System notice" }];
		const lines = area.render(80);
		expect(lines.some((l) => l.includes("System notice"))).toBe(true);
	});

	it("respects width when rendering", () => {
		const area = new ChatLogArea();
		area.messages = [{ role: "user", content: "x".repeat(200) }];
		const width = 40;
		const lines = area.render(width);
		for (const line of lines) {
			const visibleLength = line.replace(/\x1b\[[^m]*m/g, "").length;
			expect(visibleLength).toBeLessThanOrEqual(width + 20);
		}
	});
});
