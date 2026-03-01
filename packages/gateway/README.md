# @monou/gateway

Gateway protocol types and client for CLI/TUI or other apps to call ParameciumU Gateway.

- **protocol**：`GatewayRequest`、`GatewayResponse`、`GatewayEvent`、`GATEWAY_METHODS`、`GATEWAY_EVENTS`、`ConnectIdentity`
- **client**：`callGateway({ url, method, params, timeoutMs })` — 单次 WebSocket RPC

## 用法

```ts
import { callGateway } from "@monou/gateway";

const jobs = await callGateway<{ jobs: unknown[] }>({
  url: "ws://127.0.0.1:9347",
  method: "cron.list",
  params: { includeDisabled: true },
});
```
