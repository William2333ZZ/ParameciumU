# Gateway address: confirming connectivity

## Why the address matters

A new agent connects to the Gateway running on **your local machine** via `agent-client`. You must know the correct WebSocket address before starting `agent-client`, otherwise the agent cannot register and will not appear in Control UI.

## Local agent (same machine as Gateway)

Use `ws://127.0.0.1:9347` (the default port for `npm run gateway`). If you changed the port, substitute accordingly.

## Remote agent (different machine from Gateway)

The remote machine must reach **your local Gateway**. `127.0.0.1` is not routable from another machine — you need one of:

- **LAN IP**: start Gateway with `GATEWAY_HOST=0.0.0.0 npm run gateway`, then use `ws://<your-LAN-IP>:9347`. Run `scripts/get-local-gateway-url.sh` to print the correct URL.
- **SSH reverse tunnel**: `ssh -R 9347:127.0.0.1:9347 REMOTE_USER@REMOTE_HOST` — on the remote machine set `GATEWAY_URL=ws://127.0.0.1:9347`.
- **Public IP / VPN**: use the routable address and make sure the port is open.

When you do not have the address, ask the user: *"The remote agent needs to connect to your local Gateway. What address should it use? If using the default port, try `ws://<your-LAN-IP>:9347`."*

## Getting the local LAN URL

Run from the monoU root:

```bash
"$AGENT_DIR/skills/agent-creator/scripts/get-local-gateway-url.sh"
# or with a custom port:
"$AGENT_DIR/skills/agent-creator/scripts/get-local-gateway-url.sh" 9347
```

The script prints the local LAN IP and the `GATEWAY_URL` the remote should use, and reminds you to start Gateway with `GATEWAY_HOST=0.0.0.0`.

## Format

- Plain: `ws://<host>:<port>`
- TLS: `wss://<host>:<port>`

## Authentication

If the Gateway requires a token or password, pass `GATEWAY_TOKEN` or `GATEWAY_PASSWORD` as environment variables to `agent-client`.
