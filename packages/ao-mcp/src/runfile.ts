import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { readFile } from "node:fs/promises";

/** Shape of ~/.ao/running.json (and AO_RUN_FILE overrides). */
export type RunfileInfo = {
  pid: number;
  port: number;
  startedAt?: string;
  owner?: string;
};

export type DiscoveredRunfile = {
  path: string;
  info: RunfileInfo;
};

/** Packaged / `ao start` handshake path. */
export function defaultRunfilePath(): string {
  return join(homedir(), ".ao", "running.json");
}

/** Isolated `npm run dev` handshake path. */
export function devRunfilePath(): string {
  return join(homedir(), ".ao", "dev", "running.json");
}

/**
 * Candidate run-file paths in preference order.
 * Explicit AO_RUN_FILE wins; otherwise try packaged then isolated-dev.
 */
export function candidateRunfilePaths(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const override = env.AO_RUN_FILE?.trim();
  if (override) {
    return [isAbsolute(override) ? override : join(process.cwd(), override)];
  }
  return [defaultRunfilePath(), devRunfilePath()];
}

/** @deprecated Prefer candidateRunfilePaths / discoverRunfile. Kept for callers that need one path. */
export function resolveRunfilePath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return candidateRunfilePaths(env)[0]!;
}

/**
 * Read the daemon handshake file. Missing file → null (daemon not recorded).
 * Malformed JSON or missing port throws.
 */
export async function readRunfile(path: string): Promise<RunfileInfo | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw err;
  }
  const parsed = JSON.parse(raw) as Partial<RunfileInfo>;
  if (
    typeof parsed.port !== "number" ||
    !Number.isInteger(parsed.port) ||
    parsed.port < 1
  ) {
    throw new Error(`invalid run-file ${path}: missing or invalid port`);
  }
  if (typeof parsed.pid !== "number" || !Number.isInteger(parsed.pid)) {
    throw new Error(`invalid run-file ${path}: missing or invalid pid`);
  }
  return {
    pid: parsed.pid,
    port: parsed.port,
    startedAt: parsed.startedAt,
    owner: parsed.owner,
  };
}

/**
 * Find the first existing run-file among candidates.
 * When AO_RUN_FILE is unset, this accepts either packaged (~/.ao) or that
 * checkout's isolated-dev (~/.ao/dev) daemon.
 */
export async function discoverRunfile(
  env: NodeJS.ProcessEnv = process.env,
): Promise<DiscoveredRunfile | null> {
  const tried: string[] = [];
  for (const path of candidateRunfilePaths(env)) {
    tried.push(path);
    const info = await readRunfile(path);
    if (info) return { path, info };
  }
  return null;
}

export function noDaemonMessage(tried: string[]): string {
  return (
    `AO daemon is not running (no run-file at ${tried.join(" or ")}). ` +
    `Start the desktop app, \`npm run dev\` in frontend/, or \`ao start\`.`
  );
}
