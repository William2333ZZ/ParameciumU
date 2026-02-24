#!/usr/bin/env node
/**
 * 从 .u 跑一轮 agent（npm run u）。
 * 使用 @monou/agent-from-dir，首次运行会从 agent-template 初始化 .u。
 */

import "dotenv/config";
import process from "node:process";
import {
  ensureAgentDir,
  getAgentDir,
  buildSessionFromU,
  createAgentContextFromU,
} from "@monou/agent-from-dir";
import { runAgentTurnWithTools } from "@monou/agent-sdk";

const rootDir = process.cwd();
const agentDir = getAgentDir(rootDir);
console.error(`U_base: agent 目录 ${agentDir}（首次运行会从模板初始化）`);
ensureAgentDir({ rootDir });
const session = await buildSessionFromU(rootDir);
const userInput = process.argv.slice(2).join(" ") || "列出当前目录下的文件名。";
const { state, config, streamFn } = createAgentContextFromU(session);
const result = await runAgentTurnWithTools(
  state,
  config,
  streamFn,
  userInput,
  session.executeTool,
);
console.log("Agent 回复:", result.text);
if (result.toolCalls?.length) {
  console.log(
    "工具调用:",
    result.toolCalls.map((t) => ({ name: t.name, args: t.arguments })),
  );
}
