# New remote host: full setup flow

When creating an agent on a different machine, follow these steps in order. Never hardcode SSH credentials — ask the user.

## 1. Check the remote host

SSH in and determine the OS and whether monoU already exists:

**Linux/macOS:**
```bash
ssh REMOTE_USER@REMOTE_HOST "uname -a"
ssh REMOTE_USER@REMOTE_HOST "test -d monoU && echo HAS_MONOU || echo NO_MONOU"
```

**Windows** (SSH defaults to `cmd` on Windows — no Unix commands):
```bash
ssh REMOTE_USER@REMOTE_HOST "cmd /c \"echo %OS%\""
ssh REMOTE_USER@REMOTE_HOST "cmd /c \"if exist monoU echo HAS_MONOU\""
```

If the output is `NO_MONOU` or blank, proceed to step 2. If `HAS_MONOU`, skip to step 3.

## 2. Copy monoU to the remote host

### 2a. Remote is Linux or macOS

Use **rsync** (preferred) or `scripts/deploy-to-remote.sh`:

```bash
REMOTE_USER=<user> REMOTE_HOST=<host> REMOTE_PATH=~/ \
  "$AGENT_DIR/skills/agent-creator/scripts/deploy-to-remote.sh"
```

Or manually:
```bash
rsync -avz --exclude node_modules --exclude .git --exclude dist \
  ./ REMOTE_USER@REMOTE_HOST:~/monoU/
```

### 2b. Remote is Windows

Windows usually has no rsync. Use **tar + scp**:

```bash
# 1. Pack on local machine (monoU root)
tar --exclude=node_modules --exclude=.git --exclude=dist -czf /tmp/monoU-sync.tar.gz .

# 2. Upload to remote
scp /tmp/monoU-sync.tar.gz REMOTE_USER@REMOTE_HOST:monoU-sync.tar.gz

# 3. Extract on remote
ssh REMOTE_USER@REMOTE_HOST "if not exist monoU mkdir monoU && tar -xzf monoU-sync.tar.gz -C monoU"
```

## 3. Build on the remote

SSH in and run in the monoU directory:

**Linux/macOS:**
```bash
cd monoU && npm install && npm run build
```

**Windows** (if root `npm run build` fails due to script paths, build packages individually in dependency order):
```bash
cd monoU
npm install
# build in order if needed:
npm run build --workspace=packages/llm-provider
npm run build --workspace=packages/agent-template
npm run build --workspace=packages/agent-from-dir
npm run build --workspace=packages/tui
npm run build --workspace=packages/gateway
npm run build --workspace=@monou/gateway-app
```

Verify `apps/gateway/dist/agent-client.js` exists before continuing.

## 4. Create agent directory and start agent-client

### 4a. Linux/macOS

Run on the remote (or via SSH):

```bash
# Create agent directory (uses packages/agent-template/template as source)
AGENT_DIR=$(pwd)/agents/<agent_id> MONOU_ROOT=$(pwd) SKILLS="base_skill memory cron" \
  .first_paramecium/skills/agent-creator/scripts/create-agent-dir.sh

# Start agent-client in background
nohup env GATEWAY_URL=ws://<local-reachable-address>:9347 \
  AGENT_ID=<agent_id> \
  AGENT_DIR=$(pwd)/agents/<agent_id> \
  .first_paramecium/skills/agent-creator/scripts/start-agent-client.sh \
  >> .gateway/agent-<agent_id>.log 2>&1 &
```

Replace `<local-reachable-address>` with the address the remote can reach your local Gateway on (see [gateway-connect.md](gateway-connect.md)).

### 4b. Windows

No shell scripts on the remote. Two options:

**Option A (recommended):** Create the agent dir locally using `create-agent-dir.sh`, tar it, scp to remote, and extract into `monoU/agents/`.

**Option B:** On the remote, manually create the directory structure mirroring `.first_paramecium` (SOUL.md, IDENTITY.md, cron/jobs.json, skills/ with base_skill/memory/cron).

Start `agent-client` on Windows (always use absolute paths for `AGENT_DIR`):

```cmd
cd /d C:\Users\<username>\monoU
set GATEWAY_URL=ws://<local-reachable-address>:9347
set AGENT_ID=<agent_id>
set AGENT_DIR=C:\Users\<username>\monoU\agents\<agent_id>
node apps\gateway\dist\agent-client.js
```

**Persistent start (recommended):** `start /b` via SSH dies when SSH disconnects. Use a **scheduled task** instead — run `scripts/start-remote-windows-agent.sh` from your local machine to automate this. See [remote-windows-start.md](remote-windows-start.md).

## 5. Make your local Gateway reachable

Start Gateway bound to all interfaces so the remote can connect:

```bash
GATEWAY_HOST=0.0.0.0 npm run gateway
```

Or use an SSH reverse tunnel — see [gateway-connect.md](gateway-connect.md).
