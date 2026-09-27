import { posix, win32 } from "node:path";

export type CliMode = "serve" | "print-config";

export type ParsedCli = {
  mode: CliMode;
  wake: boolean;
};

function wakeFromEnv(env: NodeJS.ProcessEnv): boolean {
  const raw = env.AO_MCP_WAKE?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

/**
 * Parse MCP process argv (already sliced past node + script).
 * Unknown flags other than --wake are ignored for forward compatibility.
 */
export function parseCli(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): ParsedCli {
  const args = argv.filter((a) => a !== "--");
  const wake = args.includes("--wake") || wakeFromEnv(env);
  if (args[0] === "print-config") {
    return { mode: "print-config", wake };
  }
  return { mode: "serve", wake };
}

/** Stable launcher path under ~/.ao/bin (state root, not AO_DATA_DIR/data). */
export function defaultShimPath(
  homeDir: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const join = platform === "win32" ? win32.join : posix.join;
  const name = platform === "win32" ? "ao-mcp.cmd" : "ao-mcp";
  return join(homeDir, ".ao", "bin", name);
}
