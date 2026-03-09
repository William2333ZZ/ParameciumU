# Remote Deploy (Linux/macOS)

## Sync repo

```bash
REMOTE_USER=<user> REMOTE_HOST=<host> REMOTE_PATH=~/monoU \
  .first_paramecium/skills/agent-creator/scripts/deploy-to-remote.sh
```

## Build remotely

```bash
ssh <user>@<host> "cd ~/monoU && npm install && npm run build"
```

## Start remote agent

```bash
ssh <user>@<host> "cd ~/monoU && \
  GATEWAY_URL=ws://<reachable-host>:9347 \
  AGENT_ID=<agent_id> \
  AGENT_DIR=$(pwd)/agents/<agent_id> \
  node apps/gateway/dist/agent-client.js"
```

See [gateway-connect.md](gateway-connect.md) for URL selection.
