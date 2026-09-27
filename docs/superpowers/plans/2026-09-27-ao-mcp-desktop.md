# AO MCP Desktop Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden `packages/ao-mcp` (wake + print-config), ship it with the desktop app, and refresh a stable host-agnostic launcher under `~/.ao/bin` so any MCP client can drive Kanban tasks without checkout paths or Cursor-specific env.

**Architecture:** Keep the TypeScript stdio MCP server. Bundle it with esbuild into `frontend/resources/ao-mcp/`. On packaged app start, write a launcher at `~/.ao/bin/ao-mcp[.cmd]` that invokes the app’s already-bundled ACP Node against that script (absolute paths baked at refresh time). Optional `--wake` / `AO_MCP_WAKE=1` launches the installed desktop app and polls `/readyz`.

**Tech Stack:** TypeScript, Vitest, `@modelcontextprotocol/sdk`, esbuild, Electron Forge `extraResource`, Node child_process.

**Packaging decision:** No separate Node SEA/pkg binary for v1. Reuse `resources/acp-runtime/node` (already shipped). Launcher is a small shell/cmd script at `~/.ao/bin`.

**State-dir note:** Daemon `AO_DATA_DIR` is `~/.ao/data` (packaged). Runfile and MCP bin live under the AO state root `~/.ao/` (same parent as `running.json`), not under `data/`. Implement shim as `~/.ao/bin/ao-mcp[.cmd]`.

**Wake constants:** Poll every 500ms; timeout 60s; readiness `GET http://127.0.0.1:<port>/readyz` (2xx = ready).

---

### Task 1: Commit existing `packages/ao-mcp` baseline

**Files:**
- Add: `packages/ao-mcp/**` (already present, untracked)

- [ ] **Step 1: Ensure build + tests pass**

```bash
cd packages/ao-mcp
npm ci
npm test
npm run build
```

Expected: all unit tests pass; `dist/` built.

- [ ] **Step 2: Commit the package baseline**

```bash
git add packages/ao-mcp
git commit -m "feat(mcp): ✨ add ao-mcp stdio server for Kanban tasks"
```

Do not commit `node_modules` or local Cursor mcp.json.

---

### Task 2: CLI flags — `--wake`, `print-config`, `AO_MCP_WAKE`

**Files:**
- Create: `packages/ao-mcp/src/cli.ts`
- Create: `packages/ao-mcp/src/cli.test.ts`
- Create: `packages/ao-mcp/src/print-config.ts`
- Create: `packages/ao-mcp/src/print-config.test.ts`
- Modify: `packages/ao-mcp/src/index.ts`
- Modify: `packages/ao-mcp/mcp.example.json`

- [ ] **Step 1: Failing tests for argv/env parsing and print-config**

```ts
// cli.test.ts
import { describe, expect, it } from "vitest";
import { parseCli } from "./cli.js";

describe("parseCli", () => {
  it("defaults to serve with wake off", () => {
    expect(parseCli([], {})).toEqual({ mode: "serve", wake: false });
  });
  it("enables wake from --wake", () => {
    expect(parseCli(["--wake"], {})).toEqual({ mode: "serve", wake: true });
  });
  it("enables wake from AO_MCP_WAKE=1", () => {
    expect(parseCli([], { AO_MCP_WAKE: "1" })).toEqual({ mode: "serve", wake: true });
  });
  it("parses print-config [--wake]", () => {
    expect(parseCli(["print-config"], {})).toEqual({ mode: "print-config", wake: false });
    expect(parseCli(["print-config", "--wake"], {})).toEqual({ mode: "print-config", wake: true });
  });
});
```

```ts
// print-config.test.ts
import { describe, expect, it } from "vitest";
import { formatMcpConfig } from "./print-config.js";

describe("formatMcpConfig", () => {
  it("emits command-only mcpServers fragment", () => {
    const json = formatMcpConfig({
      command: "C:\\\\Users\\\\x\\\\.ao\\\\bin\\\\ao-mcp.cmd",
      wake: false,
    });
    expect(JSON.parse(json)).toEqual({
      mcpServers: { ao: { command: "C:\\\\Users\\\\x\\\\.ao\\\\bin\\\\ao-mcp.cmd" } },
    });
  });
  it("adds args [--wake] when wake true", () => {
    const json = formatMcpConfig({ command: "/home/u/.ao/bin/ao-mcp", wake: true });
    expect(JSON.parse(json).mcpServers.ao.args).toEqual(["--wake"]);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL (modules missing)**

```bash
cd packages/ao-mcp && npm test -- src/cli.test.ts src/print-config.test.ts
```

- [ ] **Step 3: Implement**

```ts
// cli.ts
export type CliMode = "serve" | "print-config";
export type ParsedCli = { mode: CliMode; wake: boolean };

export function parseCli(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): ParsedCli {
  const args = argv.filter((a) => a !== "--");
  const wake =
    args.includes("--wake") ||
    env.AO_MCP_WAKE?.trim() === "1" ||
    env.AO_MCP_WAKE?.trim().toLowerCase() === "true";
  if (args[0] === "print-config") {
    return { mode: "print-config", wake };
  }
  return { mode: "serve", wake };
}
```

```ts
// print-config.ts
export function defaultShimPath(
  homeDir: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const name = platform === "win32" ? "ao-mcp.cmd" : "ao-mcp";
  return `${homeDir}/.ao/bin/${name}`.replace(/\//g, platform === "win32" ? "\\" : "/");
  // Prefer path.join in real code.
}

export function formatMcpConfig(opts: { command: string; wake: boolean }): string {
  const entry: { command: string; args?: string[] } = { command: opts.command };
  if (opts.wake) entry.args = ["--wake"];
  return `${JSON.stringify({ mcpServers: { ao: entry } }, null, 2)}\n`;
}
```

Update `index.ts` to parse `process.argv.slice(2)`, handle `print-config` (stdout + exit 0), else start MCP. Pass `wake` into server/client readiness (Task 3).

Update `mcp.example.json` to document shim path + optional `--wake` (no `AO_RUN_FILE`, no repo path).

- [ ] **Step 4: Re-run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/ao-mcp/src/cli.ts packages/ao-mcp/src/cli.test.ts packages/ao-mcp/src/print-config.ts packages/ao-mcp/src/print-config.test.ts packages/ao-mcp/src/index.ts packages/ao-mcp/mcp.example.json
git commit -m "feat(mcp): ✨ add print-config and --wake CLI flags"
```

---

### Task 3: Wake launcher (discover → optional launch → poll `/readyz`)

**Files:**
- Create: `packages/ao-mcp/src/wake.ts`
- Create: `packages/ao-mcp/src/wake.test.ts`
- Create: `packages/ao-mcp/src/app-locations.ts`
- Create: `packages/ao-mcp/src/app-locations.test.ts`
- Modify: `packages/ao-mcp/src/client.ts` (ensureReady / integrate wake)
- Modify: `packages/ao-mcp/src/server.ts` or `index.ts` to call ensure before tools

- [ ] **Step 1: Failing tests for known locations + wake skip/fail/timeout**

```ts
// app-locations.test.ts — inject env/home; assert Windows LOCALAPPDATA path, macOS /Applications, Linux AppImage under ~/.ao
// wake.test.ts — mock discoverRunfile, fetch, spawn:
//   healthy daemon + wake → no spawn
//   no daemon + wake off → throws start-app message
//   no daemon + wake on + no bundle → throws "no installed Agent Orchestrator"
//   no daemon + wake on + bundle → spawn once, then succeed after fake runfile appears
```

Constants in `wake.ts`:

```ts
export const WAKE_TIMEOUT_MS = 60_000;
export const WAKE_POLL_MS = 500;
```

`knownAppLocations(platform, env, homeDir): string[]` mirrors Go `knownAppLocations` in `backend/internal/cli/start.go` (Windows NSIS per-user + Program Files; macOS Applications; Linux `~/.ao/agent-orchestrator.AppImage` + `~/Applications/...`).

`launchApp(bundlePath, platform)` — win32: `spawn(bundlePath, [], { detached: true, stdio: "ignore" })`; darwin: `spawn("open", ["-a", bundlePath], …)` or `open` on `.app`; linux: `spawn(bundlePath, …)`.

`ensureDaemonReady({ wake, … })`:
1. If discoverRunfile + `/readyz` ok → return base URL.
2. If !wake → throw `noDaemonMessage(...)`.
3. Resolve first existing known location; if none → throw no-install error.
4. Launch; poll until ready or `WAKE_TIMEOUT_MS`.

Wire into `DaemonClient` so every tool path calls `ensureDaemonReady` once per process (memoize promise).

- [ ] **Step 2: Implement until tests pass**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(mcp): ✨ wake installed desktop app when --wake set"
```

---

### Task 4: esbuild bundle into `frontend/resources/ao-mcp`

**Files:**
- Create: `frontend/scripts/build-ao-mcp.mjs`
- Create: `frontend/scripts/build-ao-mcp.test.mjs` (or assert in existing node:test style if used)
- Modify: `frontend/package.json` (script `build:ao-mcp`)
- Modify: `frontend/forge.config.ts` — add `resources/ao-mcp` to `extraResourcesForPlatform`
- Add: `frontend/resources/ao-mcp/.gitkeep` or generate on build; gitignore bundled output if preferred — **commit the build script; generate artifact in CI/package scripts like acp-runtime**

- [ ] **Step 1: Add build script**

```js
// build-ao-mcp.mjs — npm run build in packages/ao-mcp, then esbuild
// entry: packages/ao-mcp/dist/index.js (or src/index.ts via esbuild ts)
// outfile: frontend/resources/ao-mcp/index.js
// bundle: true, platform: node, format: esm, packages: bundle all deps
```

Add `esbuild` as a frontend (or ao-mcp) devDependency if missing.

Wire `build:ao-mcp` into the same package/prepackage path used for `build:acp-runtime` (grep `build:acp-runtime` in `frontend/package.json` and add a sibling call).

- [ ] **Step 2: Run build; confirm `resources/ao-mcp/index.js` exists and starts with `--help`/`print-config`**

```bash
cd frontend && npm run build:ao-mcp
node resources/ao-mcp/index.js print-config
```

- [ ] **Step 3: Commit script + forge wiring (+ lockfile if esbuild added)**

```bash
git commit -m "build(mcp): 📦 bundle ao-mcp into Electron resources"
```

---

### Task 5: Desktop refresh of `~/.ao/bin` launcher on packaged start

**Files:**
- Create: `frontend/src/main/mcp-bin-install.ts`
- Create: `frontend/src/main/mcp-bin-install.test.ts`
- Modify: `frontend/src/main.ts` — call install after app ready when `app.isPackaged`

- [ ] **Step 1: Failing unit tests**

```ts
// mcp-bin-install.test.ts
// given fake resources paths for node + index.js and a temp home,
// installMcpBin writes ~/.ao/bin/ao-mcp.cmd (win) or ao-mcp (unix)
// with absolute paths; sets executable bit on unix; idempotent replace
```

```ts
export type McpBinInstallPaths = {
  homeDir: string;
  nodePath: string;   // .../acp-runtime/node/bin/node(.exe)
  scriptPath: string; // .../resources/ao-mcp/index.js
  platform: NodeJS.Platform;
};

export async function installMcpBin(paths: McpBinInstallPaths): Promise<string> {
  // mkdir ~/.ao/bin; write launcher; return absolute shim path
}
```

Windows launcher content:

```bat
@echo off
"<nodePath>" "<scriptPath>" %*
```

Unix:

```sh
#!/bin/sh
exec "<nodePath>" "<scriptPath>" "$@"
```

Resolve real paths in `main.ts`:

```ts
const nodePath = path.join(
  app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), "resources"),
  "acp-runtime", "node", "bin",
  process.platform === "win32" ? "node.exe" : "node",
);
const scriptPath = path.join(
  app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), "resources"),
  "ao-mcp", "index.js",
);
```

Packaged-only: skip install when `!app.isPackaged` (dev keeps using `node packages/ao-mcp/dist/index.js`). Log warning on failure; never throw into UI startup.

- [ ] **Step 2: Implement + test**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(desktop): ✨ refresh ~/.ao/bin/ao-mcp launcher on packaged start"
```

---

### Task 6: Settings “Copy MCP config” (optional UX)

**Files:**
- Modify: global settings surface (locate existing Settings section via semble: “GlobalSettingsForm” or similar)
- Add: small button that copies `formatMcpConfig` output via IPC
- Create: `frontend/src/main/mcp-config-ipc.ts` if needed
- Test: unit/component test for copy payload

- [ ] **Step 1: IPC `mcp:get-config-snippet` returns print-config JSON for shim path under `os.homedir()/.ao/bin`**
- [ ] **Step 2: Settings button “Copy MCP config” → clipboard**
- [ ] **Step 3: Commit**

```bash
git commit -m "feat(desktop): ✨ copy host-agnostic MCP config from Settings"
```

If Settings plumbing is large, ship Tasks 1–5 first and do this as a thin follow-up in the same PR only if time allows — **required for plan completion: at least `ao-mcp print-config` works (Task 2).**

---

### Task 7: Docs + example cleanup

**Files:**
- Modify: `packages/ao-mcp/mcp.example.json`
- Create or update short section in existing docs (prefer `docs/` note or README blurb under `packages/ao-mcp/README.md` — only if repo already documents packages this way; otherwise keep `mcp.example.json` + comment in design spec link)

- [ ] Document generic snippet using `~/.ao/bin/ao-mcp`, optional `--wake`, “start AO first”, Windows `.cmd` path.
- [ ] Commit: `docs(mcp): 📝 document host-agnostic MCP setup`

---

### Task 8: Verification

- [ ] `cd packages/ao-mcp && npm test && npm run build`
- [ ] `cd frontend && npm run build:ao-mcp` (and typecheck touched main files)
- [ ] Manual Windows (when app available): after packaged or after simulating `installMcpBin`, run shim `print-config`; with daemon up, `list_tasks` via smoke; with daemon down, confirm fail vs `--wake`

---

## Spec coverage

| Spec requirement | Task |
|---|---|
| Stdio tools list/create/update | Task 1 (existing) |
| Stable `~/.ao/bin` launcher | Task 5 |
| Host-agnostic config / print-config | Task 2, 6, 7 |
| Fail if daemon down | Task 3 |
| Optional `--wake` | Task 2, 3 |
| Package with desktop | Task 4 |
| No auto-write IDE configs | Task 6 clipboard only |
| Wake timeout documented | Task 3 constants + errors |
| Tests | Tasks 2–5 |

## Out of scope (do not implement)

- Go `ao mcp` rewrite
- Auto-edit Cursor/Claude config files
- Kanban column moves
- Waking forge/`npm run dev` checkouts
