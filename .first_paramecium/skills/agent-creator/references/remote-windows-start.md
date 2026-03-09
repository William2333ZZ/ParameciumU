# Remote Windows Persistent Start

`start /b node ...` over SSH is not persistent. Use a Scheduled Task.

## Recommended command (from local machine)

```bash
REMOTE_USER=<user> REMOTE_HOST=<host> \
AGENT_ID=<agent_id> GATEWAY_URL=ws://<reachable-host>:9347 \
REMOTE_MONOU='C:\Users\<username>\monoU' \
  .first_paramecium/skills/agent-creator/scripts/start-remote-windows-agent.sh
```

Optional:

- `REMOTE_AGENT_DIR='C:\...\agents\<agent_id>'`
- `KILL_FIRST=1`
- `SSHPASS=<password>`

## What the script does

1. Generate `start-<agent_id>.bat`
2. Upload to remote monoU dir
3. Create/overwrite task `MonouAgent_<agent_id>`
4. Trigger task run

After a few seconds, refresh Control UI.
