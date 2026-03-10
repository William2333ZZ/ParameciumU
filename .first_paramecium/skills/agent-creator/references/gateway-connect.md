# Gateway Connectivity

Agents connect to Gateway through `GATEWAY_URL`.

## Local (same machine)

Use:

```text
ws://127.0.0.1:9347
```

## Remote (different machine)

`127.0.0.1` is invalid from remote host. Use one of:

- LAN URL: `ws://<local-lan-ip>:9347` with Gateway started as `GATEWAY_HOST=0.0.0.0`
- SSH reverse tunnel: remote uses `ws://127.0.0.1:9347` via `ssh -R`
- VPN/public route

## Quick command

```bash
.first_paramecium/skills/agent-creator/scripts/get-local-gateway-url.sh
```

## Authentication

If enabled, pass `GATEWAY_TOKEN` or `GATEWAY_PASSWORD` when launching the agent app.
