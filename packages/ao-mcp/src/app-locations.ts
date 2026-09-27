import { existsSync } from "node:fs";
import { posix, win32 } from "node:path";

/**
 * Installed desktop bundle candidates (packaged only — never forge checkouts).
 * Mirrors backend/internal/cli/start.go knownAppLocations.
 */
export function knownAppLocations(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  homeDir: string,
): string[] {
  const join = platform === "win32" ? win32.join : posix.join;
  switch (platform) {
    case "darwin": {
      const name = "Agent Orchestrator.app";
      return [
        join("/Applications", name),
        join(homeDir, "Applications", name),
      ];
    }
    case "win32": {
      const paths: string[] = [];
      const local = env.LOCALAPPDATA?.trim();
      if (local) {
        paths.push(
          join(local, "Programs", "Agent Orchestrator", "agent-orchestrator.exe"),
        );
      }
      const pf = env.ProgramFiles?.trim();
      if (pf) {
        paths.push(join(pf, "Agent Orchestrator", "agent-orchestrator.exe"));
      }
      return paths;
    }
    case "linux": {
      return [
        join(homeDir, ".ao", "agent-orchestrator.AppImage"),
        join(homeDir, "Applications", "agent-orchestrator.AppImage"),
      ];
    }
    default:
      return [];
  }
}

export function resolveInstalledApp(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  homeDir: string,
  exists: (path: string) => boolean = existsSync,
): string | null {
  for (const candidate of knownAppLocations(platform, env, homeDir)) {
    if (exists(candidate)) return candidate;
  }
  return null;
}
