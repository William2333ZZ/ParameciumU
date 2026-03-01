# Deploying monoU to a remote host

## Sync with rsync (recommended for Linux/macOS)

Run from your **local monoU root directory**:

```bash
rsync -avz \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude 'dist' \
  ./ REMOTE_USER@REMOTE_HOST:REMOTE_PATH/monoU/
```

- `REMOTE_USER`: SSH username on the remote.
- `REMOTE_HOST`: remote hostname or IP.
- `REMOTE_PATH`: base path on remote, e.g. `~/` or `/opt/`.

Or use the bundled script (auto-discovers `MONOU_ROOT`):

```bash
REMOTE_USER=<user> REMOTE_HOST=<host> REMOTE_PATH=~/monoU \
  "$AGENT_DIR/skills/agent-creator/scripts/deploy-to-remote.sh"
```

After syncing, build on the remote:

```bash
ssh REMOTE_USER@REMOTE_HOST "cd REMOTE_PATH/monoU && npm install && npm run build"
```

## Environment variables needed on the remote

Before starting `agent-client` on the remote machine, configure:

- `OPENAI_API_KEY` **or** `AIHUBMIX_API_KEY` (+ optional `AIHUBMIX_BASE_URL` / `OPENAI_BASE_URL`): required for LLM calls.
- `GATEWAY_URL`: WebSocket address of your **local** Gateway that the remote can reach (see [gateway-connect.md](gateway-connect.md)).
- `AGENT_ID`, `AGENT_DIR`: agent registration name and directory path.

## Making your local Gateway reachable from remote

By default the Gateway listens on `127.0.0.1:9347`, which is not reachable from other machines. Options:

- **Bind to all interfaces**: start with `GATEWAY_HOST=0.0.0.0 npm run gateway`, then use `ws://<your-LAN-IP>:9347` on the remote.
- **SSH reverse tunnel**: `ssh -R 9347:127.0.0.1:9347 REMOTE_USER@REMOTE_HOST` — on the remote set `GATEWAY_URL=ws://127.0.0.1:9347`.

## Starting agent-client on the remote

```bash
export GATEWAY_URL=ws://<local-reachable-address>:9347
export AGENT_ID=my_remote_agent
export AGENT_DIR=/path/on/remote/to/agent_dir
node apps/gateway/dist/agent-client.js
```

Make sure `apps/gateway/dist/agent-client.js` exists (build on remote or sync the `dist` directory).
