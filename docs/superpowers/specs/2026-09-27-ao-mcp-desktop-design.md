# AO MCP Desktop Distribution Design

## Goal

Ship a host-agnostic MCP server with the Agent Orchestrator desktop app so any
MCP client (Cursor, Claude Desktop, VS Code, and others) can list, create, and
rename Kanban board tasks (worker sessions) against the local daemon — without
hard-coding a git checkout or an IDE-specific install path.

## Background

AO already exposes a loopback HTTP API from the desktop-owned Go daemon. Kanban
"tasks" are worker sessions; column placement is derived and not writable via
PATCH. The existing TypeScript package `packages/ao-mcp` implements stdio MCP
tools `list_tasks`, `create_task`, and `update_task` as a thin HTTP client.

The current Cursor `mcp.json` pin to a repo `dist/index.js` plus
`AO_RUN_FILE=~/.ao/dev/running.json` is a local-dev hack. It is not an install
story for Windows NSIS, macOS `.app`, or Linux AppImage users.

## Scope

In scope:

- Stdio MCP runtime contract for the three task tools.
- Packaging the MCP entrypoint inside the desktop app resources.
- Refreshing a stable launcher under `$AO_DATA_DIR/bin` (default `~/.ao/bin`).
- Host-agnostic config: absolute `command` path; optional wake flag.
- Default behavior: fail clearly if the daemon is not running.
- Optional wake: when configured, launch the installed desktop app, wait for
  the daemon, then connect.
- A way for users to obtain a paste-ready MCP config snippet (CLI flag and/or
  desktop Settings copy action).
- Cross-platform path tables for Windows, macOS, and Linux; Windows is the
  first verification target.

Out of scope:

- Auto-writing Cursor, Claude Desktop, or other host config files.
- Publishing a new npm package as the primary distribution path.
- Moving Kanban cards between columns via MCP (derived status remains read-only).
- Rewriting the MCP server in Go for v1 (optional later).
- Embedding MCP inside the daemon process itself.
- Waking an unpackaged `electron-forge` / `npm run dev` checkout via `--wake`.

## Decision summary

| Decision                  | Choice                                                                                  |
| ------------------------- | --------------------------------------------------------------------------------------- |
| Transport                 | Stdio MCP (universal across hosts)                                                      |
| Distribution              | Ship with desktop; refresh stable binary under `$AO_DATA_DIR/bin`                       |
| Host setup                | User pastes generic `{ command }` config; AO does not rewrite IDE files                 |
| Daemon missing (default)  | Hard fail with "start Agent Orchestrator" guidance                                      |
| Daemon missing (optional) | `--wake` (or equivalent) launches installed app, then connects                          |
| Runfile discovery         | `AO_RUN_FILE` if set; else packaged `~/.ao/running.json`, then `~/.ao/dev/running.json` |
| Default host env          | No `AO_RUN_FILE`; no host-specific env                                                  |

## Approaches considered

### A. Stable `$AO_DATA_DIR/bin/ao-mcp` (chosen)

Desktop ships the MCP binary in app resources. On packaged launch it copies or
atomically replaces `$AO_DATA_DIR/bin/ao-mcp` (`.exe` on Windows). Every MCP
host runs that absolute path. Matches AO's rule that app-owned state lives under
`~/.ao` (or `AO_DATA_DIR`). Survives app directory moves if the desktop refreshes
the shim on start.

### B. Installer PATH only

NSIS / macOS symlink puts `ao-mcp` on PATH; host configs use `"command": "ao-mcp"`.
Rejected as the primary contract: GUI-launched hosts often miss shell PATH;
AppImage and custom install dirs make PATH fragile.

### C. Go `ao mcp` subcommand

Reuse the existing CLI binary and `knownAppLocations` for wake. Attractive
long-term, but requires a port of the working TypeScript MCP package. Deferred;
Approach A can later wrap or be replaced by `ao mcp` without changing the
stable `$AO_DATA_DIR/bin` contract if the shim stays.

## Architecture

```
[Any MCP host]
    | stdio JSON-RPC
    v
$AO_DATA_DIR/bin/ao-mcp[--wake]
    | HTTP 127.0.0.1:<port from runfile>
    v
AO daemon (desktop-owned)
```

### Components

1. **`packages/ao-mcp`** — MCP server, daemon HTTP client, runfile discovery,
   optional wake launcher. Remains the implementation for v1.
2. **Desktop packaging** — Forge/electron-builder copies a platform MCP
   artifact into `resources/` (name: `ao-mcp` / `ao-mcp.exe`).
3. **Desktop install step** — On packaged app start, refresh
   `$AO_DATA_DIR/bin/ao-mcp` from resources (clobber; version tracks the app,
   same spirit as embedded skill materialization under the data dir).
4. **Config helper** — `ao-mcp print-config` (and optional Settings "Copy MCP
   config") emits JSON with the absolute command path and an optional
   `--wake` variant. Paste into any host.

### Data flow (tool call)

1. Host spawns `ao-mcp` over stdio.
2. MCP resolves daemon base URL via runfile discovery.
3. If no runfile / unreachable daemon and `--wake` unset → error result.
4. If `--wake` set → resolve installed app bundle, launch, poll until ready or
   timeout, then proceed.
5. Tool handler calls existing daemon routes (`GET /sessions`,
   `POST /orchestrators/delegate` or `POST /sessions`,
   `PATCH /sessions/{id}` for rename).
6. Response returned as MCP tool result text/JSON.

## Runtime contract

### Tools (v1)

| Tool          | Purpose                             | Daemon surface                                                        |
| ------------- | ----------------------------------- | --------------------------------------------------------------------- |
| `list_tasks`  | List board worker sessions          | `GET /api/v1/sessions` (filter orchestrators / terminated by default) |
| `create_task` | Create project or standalone worker | Delegate or `POST /api/v1/sessions`                                   |
| `update_task` | Rename only                         | `PATCH /api/v1/sessions/{id}` with `displayName`                      |

Kanban column / `displayStatus` remain derived and are returned as read-only
fields on list results where available. No MCP tool moves cards between
columns.

### Runfile discovery

Preference order:

1. `AO_RUN_FILE` if set (absolute or cwd-relative) — escape hatch for tests and
   intentional isolation.
2. `$AO_DATA_DIR/running.json` (default `~/.ao/running.json`) — packaged /
   production desktop.
3. `$AO_DATA_DIR/dev/running.json` (default `~/.ao/dev/running.json`) —
   isolated `npm run dev` desktop.

Production host snippets must not set `AO_RUN_FILE`.

### Wake flag

Canonical form: CLI argument `--wake`.

Equivalent env (accepted for hosts that prefer env): `AO_MCP_WAKE=1`. If either
is set, wake is enabled. Document `--wake` as the primary form in
`print-config` output.

Wake algorithm:

1. Attempt normal discovery + a cheap health check (e.g. `/readyz` or
   equivalent already used by the client).
2. If healthy → connect; do not relaunch.
3. If not healthy and wake disabled → fail with a message that names the
   tried runfile paths and says to start Agent Orchestrator.
4. If not healthy and wake enabled:
   - Resolve the installed desktop bundle using the same class of known
     locations as `ao start` / `knownAppLocations` (Windows per-user NSIS under
     `%LOCALAPPDATA%\Programs\Agent Orchestrator\`, per-machine Program Files
     fallback; macOS `/Applications` and `~/Applications`; Linux stable
     AppImage path and `~/Applications`).
   - Prefer a path recorded by the desktop when present (e.g. bundle path
     already written for `ao start`), then fall back to known locations.
   - Launch the app in a non-blocking way appropriate to the OS.
   - Poll runfile appearance and readiness until success or a bounded timeout
     (concrete timeout chosen in the implementation plan; must be documented
     in user-facing errors).
5. Wake must not target unpackaged Electron / forge checkouts. If no installed
   bundle is found, fail with an explicit "no installed Agent Orchestrator"
   error rather than guessing at a repo path.

## Host configuration (generic)

Any MCP host that supports a stdio server config uses:

```json
{
  "mcpServers": {
    "ao": {
      "command": "/absolute/path/to/ao-mcp"
    }
  }
}
```

With optional wake:

```json
{
  "mcpServers": {
    "ao": {
      "command": "/absolute/path/to/ao-mcp",
      "args": ["--wake"]
    }
  }
}
```

On Windows the command is the absolute path to `ao-mcp.exe` under the active
`AO_DATA_DIR` (typically `C:\Users\<user>\.ao\bin\ao-mcp.exe`).

AO must not auto-edit `~/.cursor/mcp.json`, Claude Desktop config, or other
host files. Optional Settings UX only copies text to the clipboard.

## Desktop integration

### Packaging

- Build step produces a per-platform MCP executable (or a self-contained
  launcher that does not depend on a checkout-local `node_modules`).
- Artifact is included in Electron `extraResource` (or equivalent) next to
  other bundled helpers such as ACP runtime.
- Unpackaged/dev runs may continue to invoke `node packages/ao-mcp/dist/index.js`
  for developers; the stable `$AO_DATA_DIR/bin` refresh applies to **packaged**
  launches.

### Install / refresh on start

When the packaged app starts:

1. Ensure `$AO_DATA_DIR/bin` exists.
2. Copy the bundled MCP binary to `$AO_DATA_DIR/bin/ao-mcp[.exe]`, replacing
   any previous copy.
3. On Unix, ensure the file is executable.

Failure to refresh the shim must not block the desktop UI; log a warning.
MCP users who hit a stale or missing shim see a clear error from the host.

### Config helper UX

Minimum: `ao-mcp print-config [--wake]` writes a JSON object (or a ready-to-
paste `mcpServers` fragment) to stdout using the absolute path of the running
binary / refreshed shim.

Optional: desktop Settings action "Copy MCP config" that places the same
snippet on the clipboard. This is convenience only; not required for the
architecture to work.

## Dev vs production

| Concern    | Development                                           | Production                              |
| ---------- | ----------------------------------------------------- | --------------------------------------- |
| Entrypoint | `node …/packages/ao-mcp/dist/index.js` or local build | `$AO_DATA_DIR/bin/ao-mcp`               |
| Runfile    | Auto-discover incl. `~/.ao/dev`                       | Prefer `~/.ao/running.json`             |
| Wake       | Off; start `npm run dev` / forge yourself             | Optional `--wake` against installed app |
| Host env   | No required `AO_RUN_FILE`                             | No `AO_RUN_FILE`                        |

## Error handling

- Missing runfile, wake off: name tried paths; tell user to start the app.
- Missing runfile, wake on, no installed bundle: say wake could not find an
  install; point at download / install docs, not a repo path.
- Wake timeout: say the app was launched but the daemon did not become ready
  in time.
- Daemon HTTP errors: surface status and API error envelope message when
  present; do not leak unrelated process environment.

## Testing

- Unit tests for runfile candidate order, `--wake` / `AO_MCP_WAKE` parsing, and
  wake skipped when daemon already healthy.
- Unit tests for wake bundle resolution with injected known locations (no real
  GUI launch in CI).
- Existing MCP client tests for list/create/update against a fake HTTP server.
- Smoke: stdio client against a built binary with a mock or live loopback
  daemon.
- Manual on Windows (required for v1 sign-off): packaged or lab desktop refresh
  of `~\.ao\bin\ao-mcp.exe`, paste config into an MCP host, list/create/rename
  without `AO_RUN_FILE`; repeat with `--wake` after quitting the app.
- macOS/Linux: path and packaging covered by unit tests and build wiring in v1;
  full manual host verification can follow when a runner is available.

## Phasing

1. Harden `packages/ao-mcp`: wake flag, print-config, no required env in
   examples; keep tools as today.
2. Desktop: package MCP artifact, refresh `$AO_DATA_DIR/bin` on packaged start,
   optional Settings copy action.
3. Docs: generic MCP setup snippet; platform path notes; replace checkout-based
   examples.
4. Later (optional): Go `ao mcp` or PATH alias — must preserve the stable
   `$AO_DATA_DIR/bin/ao-mcp` contract or document a migration.

## Open implementation choices (non-blocking for this spec)

These are decided in the implementation plan, not reopened as product design:

- Exact bundler for a self-contained MCP binary (e.g. Node SEA, bun compile,
  or a small native wrapper that embeds the Node entry).
- Exact readiness URL and wake poll interval / timeout values.
- Whether Settings "Copy MCP config" ships in the same PR as packaging or
  immediately after.

## Success criteria

- A Windows user with the installed desktop app can configure any stdio MCP
  host with only the absolute path to `~\.ao\bin\ao-mcp.exe` and use the three
  tools while the app is running.
- Default config does not reference this repository, Cursor, or `AO_RUN_FILE`.
- With `--wake`, quitting the app and invoking a tool relaunches the installed
  app and eventually succeeds (within timeout) or fails with a wake-specific
  error.
- Without `--wake`, the same situation fails immediately with start-app
  guidance.
