import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export type McpBinInstallPaths = {
  homeDir: string;
  nodePath: string;
  scriptPath: string;
  platform: NodeJS.Platform;
};

export function mcpShimPath(homeDir: string, platform: NodeJS.Platform): string {
  const name = platform === "win32" ? "ao-mcp.cmd" : "ao-mcp";
  return path.join(homeDir, ".ao", "bin", name);
}

/** Host-agnostic mcpServers JSON for clipboard / print-config parity. */
export function formatMcpConfigSnippet(
  command: string,
  wake = false,
): string {
  const entry: { command: string; args?: string[] } = { command };
  if (wake) entry.args = ["--wake"];
  return `${JSON.stringify({ mcpServers: { ao: entry } }, null, 2)}\n`;
}

export function renderMcpLauncher(paths: McpBinInstallPaths): string {
  if (paths.platform === "win32") {
    return `@echo off\r\n"${paths.nodePath}" "${paths.scriptPath}" %*\r\n`;
  }
  return `#!/bin/sh\nexec "${paths.nodePath}" "${paths.scriptPath}" "$@"\n`;
}

/**
 * Refresh ~/.ao/bin/ao-mcp[.cmd] to run the packaged MCP bundle via ACP Node.
 * Returns the absolute shim path.
 */
export async function installMcpBin(paths: McpBinInstallPaths): Promise<string> {
  const shim = mcpShimPath(paths.homeDir, paths.platform);
  await mkdir(path.dirname(shim), { recursive: true });
  const body = renderMcpLauncher(paths);
  await writeFile(shim, body, { encoding: "utf8", mode: 0o755 });
  if (paths.platform !== "win32") {
    await chmod(shim, 0o755);
  }
  return shim;
}

export function resolveMcpResourcePaths(opts: {
  resourcesRoot: string;
  platform: NodeJS.Platform;
}): { nodePath: string; scriptPath: string } {
  const nodeName = opts.platform === "win32" ? "node.exe" : "node";
  return {
    nodePath: path.join(
      opts.resourcesRoot,
      "acp-runtime",
      "node",
      "bin",
      nodeName,
    ),
    scriptPath: path.join(opts.resourcesRoot, "ao-mcp", "index.js"),
  };
}
