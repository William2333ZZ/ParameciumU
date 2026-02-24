/**
 * 提交路由单元测试 — 参考 OpenClaw tui.submit-handler.test.ts
 */
import { describe, expect, it } from "vitest";
import { getSubmitAction } from "./chat-submit.js";

describe("getSubmitAction", () => {
  it("returns null for empty or whitespace-only input", () => {
    expect(getSubmitAction("")).toBeNull();
    expect(getSubmitAction("   ")).toBeNull();
    expect(getSubmitAction("\t\n")).toBeNull();
  });

  it("routes /help and /help * to help", () => {
    expect(getSubmitAction("/help")).toEqual({ type: "help" });
    expect(getSubmitAction("/help ")).toEqual({ type: "help" });
    expect(getSubmitAction("/help foo")).toEqual({ type: "help" });
  });

  it("routes /clear and /clear * to clear", () => {
    expect(getSubmitAction("/clear")).toEqual({ type: "clear" });
    expect(getSubmitAction("/clear ")).toEqual({ type: "clear" });
  });

  it("routes /cron and /cron * to cron", () => {
    expect(getSubmitAction("/cron")).toEqual({ type: "cron" });
    expect(getSubmitAction("/cron ")).toEqual({ type: "cron" });
  });

  it("routes unknown slash commands to unknown_cmd with raw", () => {
    expect(getSubmitAction("/foo")).toEqual({ type: "unknown_cmd", raw: "/foo" });
    expect(getSubmitAction("/context")).toEqual({ type: "unknown_cmd", raw: "/context" });
  });

  it("treats a lone ! as a normal message", () => {
    expect(getSubmitAction("!")).toEqual({ type: "message", value: "!" });
  });

  it("routes lines starting with ! (non-lone) to bang", () => {
    expect(getSubmitAction("!ls")).toEqual({ type: "bang", cmd: "ls" });
    expect(getSubmitAction("!echo hello")).toEqual({ type: "bang", cmd: "echo hello" });
  });

  it("does not treat leading whitespace before ! as bang", () => {
    expect(getSubmitAction("  !ls")).toEqual({ type: "message", value: "!ls" });
  });

  it("trims normal messages and returns message with trimmed value", () => {
    expect(getSubmitAction("  hello  ")).toEqual({ type: "message", value: "hello" });
    expect(getSubmitAction("hello")).toEqual({ type: "message", value: "hello" });
  });
});
