# ParameciumU Control UI

Web 前端：连接 Gateway，管理节点/Agent、对话、Cron、状态。与文档 `docs/control-ui-vision.md` 对齐。

## 开发

```bash
# 根目录
npm run control-ui

# 或
cd apps/control-ui && npm run dev
```

浏览器打开 http://localhost:5173，输入 Gateway URL（如 `ws://127.0.0.1:9347`）和可选 token/password 连接。

需先启动 Gateway：`npm run gateway`（默认 9347 端口）。

## 构建

```bash
npm run control-ui:build
```

产物在 `apps/control-ui/dist`，可交给任意静态托管或由 Gateway 同进程提供（见文档「Control UI 与 Canvas Host」）。

## 技术

- TypeScript + React + Vite
- WebSocket 直连 Gateway，协议与 `@monou/gateway` 一致（connect、health、agents.list、node.list、agent、cron.*、status、connector.mapping.*）
