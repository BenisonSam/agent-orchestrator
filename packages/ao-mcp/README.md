# @aoagents/ao-mcp

Host-agnostic MCP server for Agent Orchestrator Kanban tasks (worker sessions):
`list_tasks`, `create_task`, `update_task`.

## Production setup

1. Install and open the **Agent Orchestrator** desktop app once (it refreshes
   `~/.ao/bin/ao-mcp` / `ao-mcp.cmd` from the packaged bundle).
2. Paste a generic MCP host config:

```json
{
  "mcpServers": {
    "ao": {
      "command": "C:\\Users\\<you>\\.ao\\bin\\ao-mcp.cmd"
    }
  }
}
```

On macOS/Linux the command is `~/.ao/bin/ao-mcp`.

Generate the snippet:

```bash
~/.ao/bin/ao-mcp print-config
# optional wake-on-call:
~/.ao/bin/ao-mcp print-config --wake
```

Or use **Settings → Advanced → Copy MCP config** in the desktop app.

### Wake (optional)

By default the MCP server fails if the daemon is not running. Add `"args": ["--wake"]`
(or set `AO_MCP_WAKE=1`) to launch the installed desktop app, wait up to 60s for
`/readyz`, then connect. Wake never targets unpackaged Electron / `npm run dev`.

Do **not** set `AO_RUN_FILE` in production configs. Discovery uses
`~/.ao/running.json`, then `~/.ao/dev/running.json`.

## Development

```bash
cd packages/ao-mcp
npm ci
npm test
npm run build
node dist/index.js print-config
```

Frontend packaging:

```bash
cd frontend
npm run build:ao-mcp
```
