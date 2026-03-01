# Gateway Skill: Usage Scenarios

All scenarios require the agent to be connected to the Gateway (`npm run agent` with `GATEWAY_URL` set). Tools return an error if the Gateway is unavailable.

## 1. Discovery & overview

- **"Who is online?" / "Which agents are connected?"**  
  → `gateway_agents_list` — returns agentId, deviceId, online status, lastHeartbeatAt.

- **"What does the topology look like? Which nodes are there?"**  
  → `gateway_nodes_list` — returns L3 nodes (each with nodeId, capabilities) and L1 connectors (e.g. Feishu).

- **"Is Feishu connected?"**  
  → `gateway_nodes_list` — check whether the connectors list is non-empty and `online: true`.

- **"Is there a browser node? / Is there a sandbox node?"**  
  → `gateway_nodes_list` — look for nodes with `capabilities` containing `"browser"` or `"sandbox"`.

## 2. Capability queries

- **"What can each agent do?" / "What skills does agent X have?"**  
  → `gateway_agents_list` to get agentIds, then `gateway_skills_status(agentId)` for each.

- **"Which agent has web_search?"**  
  → `gateway_agents_list` + `gateway_skills_status(agentId)` for each, search results for the skill name.

- **"What can finance_learner do?"**  
  → `gateway_skills_status(agentId: "finance_learner")`.

## 3. Cron / scheduled tasks

- **"What scheduled tasks are there?" / "What cron jobs does the current agent have?"**  
  → `gateway_cron_list()` (no agentId = current agent).

- **"What are finance_learner's scheduled tasks?"**  
  → `gateway_cron_list(agentId: "finance_learner")`.

- **"When does the heartbeat job run next?"**  
  → `gateway_cron_list(agentId)`, find the Heartbeat job, check `nextRunAtMs`.

- **"Are there any disabled cron jobs?"**  
  → `gateway_cron_list(agentId, includeDisabled: true)`, check `enabled` on each job.

## 4. Agent delegation & orchestration

- **"Ask finance_learner to run its learning task"**  
  → `gateway_agents_list` to confirm it's online → `gateway_agent_send_to_session(targetAgentId: "finance_learner", message: "...")`.

- **"Who is best suited for this task?"**  
  → `gateway_agents_list` + `gateway_skills_status` for candidates, recommend based on skill descriptions.

- **"Send a reminder to the agent that can push messages"**  
  → `gateway_agents_list` + `gateway_skills_status` to find the right agent → `sessions_send` or `gateway_agent_send_to_session`.

## 5. Node invocation (browser / sandbox — MCP-style)

L3 nodes connect to the Gateway with `role=node` and declare `capabilities`. Use `gateway_node_invoke` to call their commands.

- **"Open a URL with the browser"**  
  → `gateway_nodes_list` to find a node with `capabilities: ["browser"]` → `gateway_node_invoke(nodeId, "browser_fetch", { url: "https://..." })`.

- **"Take a screenshot of the current page"**  
  → `gateway_node_invoke(nodeId, "browser_fetch", { currentPageOnly: true })`.

- **"Click a button / fill in a form"**  
  → `gateway_node_invoke(nodeId, "browser_click", { text: "Submit" })` or `gateway_node_invoke(nodeId, "browser_fill", { selector: "#email", text: "..." })`.

- **"Run a shell command in the sandbox"**  
  → `gateway_nodes_list` for `capabilities: ["sandbox"]` → `gateway_node_invoke(nodeId, "system.run", { command: ["ls", "-la"] })`.

- **"Check if Python is available in the sandbox"**  
  → `gateway_node_invoke(nodeId, "system.which", { bins: ["python3"] })`.

- **"No browser node found"**  
  → Use `node-creator` skill to start a browser-node and connect it to the Gateway.

## 6. Session management

- **"Show me my sessions"**  
  → `sessions_list` or `sessions_preview`.

- **"Send a message to my Feishu session"**  
  → `sessions_list` to find the sessionKey → `sessions_send(sessionKey, message)`.

## 7. Message push

- **"Push a message to the Feishu group"**  
  → `gateway_nodes_list` to get the connector's `connectorId` → `send_message(connectorId, chatId, text)`.

- **"Why isn't Feishu push working?"**  
  → `gateway_nodes_list` — check whether the Feishu connector is listed and `online: true`; also verify the connector mapping in Control UI.

## 8. Troubleshooting & ops

- **"Is agent X's cron running?"**  
  → `gateway_cron_list(agentId)` — check `nextRunAtMs` and `lastRunAtMs`; cron executes inside the Agent process, so also check that process's logs.

- **"How many agents are on this machine?"**  
  → `gateway_agents_list`, group by `deviceId`.

## 9. Combined overview

- **"Give me a full Gateway overview: who's connected, what can they do, what cron jobs does the current agent have, and what nodes are available?"**  
  → `gateway_agents_list` + `gateway_skills_status` per agent + `gateway_cron_list()` + `gateway_nodes_list`, summarize all results.
