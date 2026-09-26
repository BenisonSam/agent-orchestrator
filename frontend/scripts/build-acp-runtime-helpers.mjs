import {
  cpSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const ROOT_BUILD_TOOLS = [
  "corepack",
  "corepack.cmd",
  "npm",
  "npm.cmd",
  "npx",
  "npx.cmd",
];
const BIN_BUILD_TOOLS = ["corepack", "npm", "npx"];
const BUILD_ONLY_CONTENT = [
  "include",
  "lib",
  "node_modules",
  "share",
  "CHANGELOG.md",
  "README.md",
];

export function runtimeSourceFiles() {
  return ["package.json", "package-lock.json"];
}

export function createWorkDirectory(outputRoot) {
  // Windows runners commonly keep the checkout on D: and the OS temp directory
  // on C:. Keep extraction beside its destination so the final rename remains
  // an atomic, same-filesystem operation on every platform.
  return mkdtempSync(join(outputRoot, ".node-download-"));
}

const TRANSIENT_MOVE_CODES = new Set(["EPERM", "EBUSY", "EACCES", "EAGAIN"]);

/**
 * Move a directory onto the same filesystem. Prefers rename; on Windows (and
 * when rename hits a transient lock such as Defender scanning a freshly
 * extracted node.exe) retries, then falls back to recursive copy + delete.
 */
export function moveDirectorySync(
  source,
  destination,
  {
    platform = process.platform,
    attempts = platform === "win32" ? 8 : 1,
    delayMs = 100,
    rename = renameSync,
    copy = cpSync,
    remove = rmSync,
    sleep = sleepSync,
  } = {},
) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      rename(source, destination);
      return "rename";
    } catch (error) {
      lastError = error;
      if (!TRANSIENT_MOVE_CODES.has(error?.code) || attempt === attempts - 1) {
        break;
      }
      sleep(delayMs * (attempt + 1));
    }
  }

  try {
    copy(source, destination, { recursive: true });
    remove(source, { recursive: true, force: true });
    return "copy";
  } catch (error) {
    const detail =
      lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(
      `failed to move ${source} -> ${destination}: ${error instanceof Error ? error.message : error}` +
        (lastError ? ` (rename: ${detail})` : ""),
      { cause: error },
    );
  }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function npmInvocation(
  args,
  {
    platform = process.platform,
    execPath = process.execPath,
    npmExecPath = process.env.npm_execpath,
    commandInterpreter = process.env.ComSpec,
  } = {},
) {
  // npm exposes the JavaScript entry point of the npm instance running this
  // package script. Invoking it with Node avoids the npm.cmd shell boundary on
  // Windows and keeps the nested install on the same npm version as the build.
  if (npmExecPath) {
    return { command: execPath, args: [npmExecPath, ...args] };
  }
  if (platform === "win32") {
    return {
      command: commandInterpreter || "cmd.exe",
      args: ["/d", "/s", "/c", "npm.cmd", ...args],
    };
  }
  return { command: "npm", args };
}

/**
 * Preserve Claude's API-retry backoff in the ACP session-failure extension.
 *
 * claude-agent-acp 0.70 publishes retry count and category, but drops the
 * SDK's retry_delay_ms before the event reaches ACP clients. AO patches the
 * pinned compiled adapter during packaging so the extension's ordinary
 * `details` field carries the missing timing. The narrow block match is a
 * deliberate upgrade tripwire: if upstream changes this code, packaging fails
 * instead of silently returning to an unobservable retry loop.
 */
export function patchClaudeRetryDetails(adapterPath) {
  const source = readFileSync(adapterPath, "utf8");
  const caseStart = source.indexOf('case "api_retry": {');
  const caseEnd = source.indexOf('case "model_refusal_fallback":', caseStart);
  if (caseStart < 0 || caseEnd < 0) {
    throw new Error(
      "claude-agent-acp no longer contains the expected api_retry block",
    );
  }

  let block = source.slice(caseStart, caseEnd);
  if (block.includes("const retryDetails =")) return false;

  const publishMarker = "await publishSessionFailure";
  const publishAt = block.indexOf(publishMarker);
  const severityMarker =
    '                                    severity: "warning",';
  if (publishAt < 0 || !block.includes(severityMarker)) {
    throw new Error(
      "claude-agent-acp api_retry block no longer matches AO's retry patch",
    );
  }

  const retryDetailLines = [
    "const retryDelay = message.retry_delay_ms >= 1000",
    "                                    ? `${Number((message.retry_delay_ms / 1000).toFixed(1))}s`",
    "                                    : `${message.retry_delay_ms}ms`;",
    '                                const retryDetails = `${message.error_status === null ? "Connection error." : `API error ${message.error_status}.`} Trying again in ${retryDelay}.`;',
    "                                ",
  ].join("\n");
  block = block.slice(0, publishAt) + retryDetailLines + block.slice(publishAt);
  block = block.replace(
    severityMarker,
    `${severityMarker}\n                                    details: retryDetails,`,
  );

  writeFileSync(
    adapterPath,
    source.slice(0, caseStart) + block + source.slice(caseEnd),
  );
  return true;
}

export function pruneNodeDistribution(nodeRoot) {
  // The Unix archives expose npm/corepack as bin/ symlinks into lib/. Remove
  // the entry points before their targets so packagers never see dangling
  // links. Windows keeps the launchers at the archive root instead.
  for (const name of BIN_BUILD_TOOLS) {
    removeFile(join(nodeRoot, "bin", name));
  }
  for (const name of ROOT_BUILD_TOOLS) {
    removeFile(join(nodeRoot, name));
  }
  for (const name of BUILD_ONLY_CONTENT) {
    rmSync(join(nodeRoot, name), { recursive: true, force: true });
  }
}

function removeFile(path) {
  try {
    // unlink removes a symlink itself even when its target is already absent.
    unlinkSync(path);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
