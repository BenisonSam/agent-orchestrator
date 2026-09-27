import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(scriptsDir, "..");
const repoRoot = resolve(frontendRoot, "..");
const packageRoot = join(repoRoot, "packages", "ao-mcp");
const outDir = join(frontendRoot, "resources", "ao-mcp");
const outFile = join(outDir, "index.js");

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(
      `${command} ${args.join(" ")} failed (exit ${result.status}):\n${detail}`,
    );
  }
  return result;
}

export function aoMcpOutFile(root = frontendRoot) {
  return join(root, "resources", "ao-mcp", "index.js");
}

/**
 * Build packages/ao-mcp (tsc) then esbuild-bundle into frontend/resources/ao-mcp.
 */
export async function buildAoMcp({
  packageDir = packageRoot,
  outputDir = outDir,
} = {}) {
  run("npm", ["run", "build"], packageDir);

  const require = createRequire(join(packageDir, "package.json"));
  let esbuild;
  try {
    esbuild = require("esbuild");
  } catch {
    throw new Error(
      "esbuild is required to bundle ao-mcp; install it in packages/ao-mcp",
    );
  }

  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });

  const entry = join(packageDir, "dist", "index.js");
  if (!existsSync(entry)) {
    throw new Error(`ao-mcp build missing entry: ${entry}`);
  }

  await esbuild.build({
    entryPoints: [entry],
    outfile: join(outputDir, "index.js"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
  });

  writeFileSync(
    join(outputDir, "package.json"),
    `${JSON.stringify({ type: "module", private: true }, null, 2)}\n`,
    "utf8",
  );

  writeFileSync(
    join(outputDir, "README.txt"),
    "Bundled AO MCP server. Packaged into the desktop app; refreshed to ~/.ao/bin on start.\n",
    "utf8",
  );

  return join(outputDir, "index.js");
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  buildAoMcp()
    .then((file) => {
      console.log(`built ${file}`);
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
