import { spawn, type ChildProcess } from "node:child_process";
import { homedir } from "node:os";
import {
  candidateRunfilePaths,
  discoverRunfile,
  noDaemonMessage,
  type DiscoveredRunfile,
} from "./runfile.js";
import { resolveInstalledApp } from "./app-locations.js";

export const WAKE_TIMEOUT_MS = 60_000;
export const WAKE_POLL_MS = 500;

export type WakeDeps = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homeDir?: string;
  fetchImpl?: typeof fetch;
  discover?: (env: NodeJS.ProcessEnv) => Promise<DiscoveredRunfile | null>;
  resolveApp?: () => string | null;
  launch?: (bundlePath: string) => void | Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
  pollMs?: number;
};

export function noInstallMessage(): string {
  return (
    "AO MCP --wake could not find an installed Agent Orchestrator app. " +
    "Install the desktop app from GitHub Releases, then retry. " +
    "Wake does not target unpackaged Electron / npm run dev checkouts."
  );
}

export function wakeTimeoutMessage(timeoutMs: number): string {
  return (
    `AO MCP launched Agent Orchestrator but the daemon was not ready within ${timeoutMs}ms. ` +
    `Check that the app starts normally, then retry.`
  );
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

export async function checkReadyz(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const res = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/readyz`, {
      method: "GET",
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function launchInstalledApp(
  bundlePath: string,
  platform: NodeJS.Platform,
): ChildProcess {
  if (platform === "darwin") {
    return spawn("open", ["-a", bundlePath], {
      detached: true,
      stdio: "ignore",
    });
  }
  if (platform === "linux") {
    return spawn(bundlePath, [], {
      detached: true,
      stdio: "ignore",
    });
  }
  // win32
  return spawn(bundlePath, [], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
}

/**
 * Resolve a healthy daemon base URL. When wake is false and no daemon is up,
 * throws immediately. When wake is true, launches the installed app and polls.
 */
export async function ensureDaemonReady(
  wake: boolean,
  deps: WakeDeps = {},
): Promise<string> {
  const env = deps.env ?? process.env;
  const platform = deps.platform ?? process.platform;
  const homeDir = deps.homeDir ?? homedir();
  const fetchImpl = deps.fetchImpl ?? fetch;
  const discover = deps.discover ?? discoverRunfile;
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? Date.now;
  const timeoutMs = deps.timeoutMs ?? WAKE_TIMEOUT_MS;
  const pollMs = deps.pollMs ?? WAKE_POLL_MS;

  const tryOnce = async (): Promise<string | null> => {
    const found = await discover(env);
    if (!found) return null;
    const base = `http://127.0.0.1:${found.info.port}`;
    if (await checkReadyz(base, fetchImpl)) return base;
    return null;
  };

  const ready = await tryOnce();
  if (ready) return ready;

  if (!wake) {
    throw new Error(noDaemonMessage(candidateRunfilePaths(env)));
  }

  const resolveApp =
    deps.resolveApp ??
    (() => resolveInstalledApp(platform, env, homeDir));
  const bundle = resolveApp();
  if (!bundle) {
    throw new Error(noInstallMessage());
  }

  const launch =
    deps.launch ??
    ((path: string) => {
      const child = launchInstalledApp(path, platform);
      child.unref();
    });
  await launch(bundle);

  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    await sleep(pollMs);
    const again = await tryOnce();
    if (again) return again;
  }
  throw new Error(wakeTimeoutMessage(timeoutMs));
}
