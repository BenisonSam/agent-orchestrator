// @vitest-environment node
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createWorkDirectory,
  moveDirectorySync,
  npmInvocation,
  patchClaudeRetryDetails,
  pruneNodeDistribution,
  runtimeSourceFiles,
} from "./build-acp-runtime-helpers.mjs";

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("createWorkDirectory", () => {
  it("places extraction on the output filesystem", () => {
    const outputRoot = temporaryDirectory();
    const workDirectory = createWorkDirectory(outputRoot);

    expect(dirname(workDirectory)).toBe(outputRoot);
    expect(existsSync(workDirectory)).toBe(true);
  });
});

describe("runtimeSourceFiles", () => {
  it("packages and fingerprints the ACP runtime manifest", () => {
    expect(runtimeSourceFiles()).toEqual(["package.json", "package-lock.json"]);
  });
});

describe("npmInvocation", () => {
  it("runs the parent npm CLI through Node on Windows", () => {
    expect(
      npmInvocation(["ci", "--omit=dev"], {
        platform: "win32",
        execPath: "C:\\node\\node.exe",
        npmExecPath: "C:\\node\\node_modules\\npm\\bin\\npm-cli.js",
        commandInterpreter: "C:\\Windows\\System32\\cmd.exe",
      }),
    ).toEqual({
      command: "C:\\node\\node.exe",
      args: [
        "C:\\node\\node_modules\\npm\\bin\\npm-cli.js",
        "ci",
        "--omit=dev",
      ],
    });
  });

  it("falls back to cmd.exe for a directly invoked Windows build script", () => {
    expect(
      npmInvocation(["ci"], {
        platform: "win32",
        npmExecPath: null,
        commandInterpreter: "C:\\Windows\\System32\\cmd.exe",
      }),
    ).toEqual({
      command: "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/c", "npm.cmd", "ci"],
    });
  });

  it("invokes npm directly on Unix when no parent npm CLI is available", () => {
    expect(
      npmInvocation(["ci"], { platform: "linux", npmExecPath: null }),
    ).toEqual({
      command: "npm",
      args: ["ci"],
    });
  });
});

describe("patchClaudeRetryDetails", () => {
  it("keeps Claude's retry delay in the published session failure", () => {
    const adapterPath = join(temporaryDirectory(), "acp-agent.js");
    writeFileSync(
      adapterPath,
      `
                            case "api_retry": {
                                const title = "retrying";
                                await publishSessionFailure(message.error_status === null
                                    ? "transport_lost"
                                    : providerFailureCategory(message.error), {
                                    title,
                                    severity: "warning",
                                });
                                break;
                            }
                            case "model_refusal_fallback": {
`,
    );

    expect(patchClaudeRetryDetails(adapterPath)).toBe(true);
    expect(patchClaudeRetryDetails(adapterPath)).toBe(false);
    const patched = readFileSync(adapterPath, "utf8");
    expect(patched).toContain("message.retry_delay_ms / 1000");
    expect(patched).toContain("Trying again in ${retryDelay}.");
    expect(patched).toContain("details: retryDetails");
  });
});

describe("moveDirectorySync", () => {
  it("renames when the filesystem allows it", () => {
    const root = temporaryDirectory();
    const source = join(root, "src");
    const destination = join(root, "dst");
    mkdirSync(source);
    writeFileSync(join(source, "node.exe"), "node");

    expect(moveDirectorySync(source, destination, { attempts: 1 })).toBe(
      "rename",
    );
    expect(existsSync(join(destination, "node.exe"))).toBe(true);
    expect(existsSync(source)).toBe(false);
  });

  it("falls back to copy+delete after transient rename locks", () => {
    const root = temporaryDirectory();
    const source = join(root, "src");
    const destination = join(root, "dst");
    mkdirSync(source);
    writeFileSync(join(source, "node.exe"), "node");

    const locked = Object.assign(new Error("locked"), { code: "EPERM" });
    let renames = 0;
    const result = moveDirectorySync(source, destination, {
      attempts: 2,
      delayMs: 1,
      sleep() {},
      rename() {
        renames += 1;
        throw locked;
      },
    });

    expect(result).toBe("copy");
    expect(renames).toBe(2);
    expect(readFileSync(join(destination, "node.exe"), "utf8")).toBe("node");
    expect(existsSync(source)).toBe(false);
  });
});

describe("pruneNodeDistribution", () => {
  it("removes Unix package-manager links before deleting their targets", () => {
    const nodeRoot = temporaryDirectory();
    const bin = join(nodeRoot, "bin");
    const npmBin = join(nodeRoot, "lib", "node_modules", "npm", "bin");
    mkdirSync(bin, { recursive: true });
    mkdirSync(npmBin, { recursive: true });
    writeFileSync(join(bin, "node"), "node");
    writeFileSync(join(npmBin, "npm-cli.js"), "npm");
    writeFileSync(join(npmBin, "npx-cli.js"), "npx");
    symlinkSync("../lib/node_modules/npm/bin/npm-cli.js", join(bin, "npm"));
    symlinkSync("../lib/node_modules/npm/bin/npx-cli.js", join(bin, "npx"));
    symlinkSync(
      "../lib/node_modules/corepack/dist/corepack.js",
      join(bin, "corepack"),
    );

    pruneNodeDistribution(nodeRoot);

    expect(readdirSync(bin)).toEqual(["node"]);
    expect(existsSync(join(nodeRoot, "lib"))).toBe(false);
  });

  it("removes package-manager files and modules from a Windows distribution", () => {
    const nodeRoot = temporaryDirectory();
    writeFileSync(join(nodeRoot, "node.exe"), "node");
    writeFileSync(join(nodeRoot, "LICENSE"), "license");
    for (const name of [
      "corepack",
      "corepack.cmd",
      "npm",
      "npm.cmd",
      "npx",
      "npx.cmd",
    ]) {
      writeFileSync(join(nodeRoot, name), name);
    }
    mkdirSync(join(nodeRoot, "node_modules", "npm"), { recursive: true });

    pruneNodeDistribution(nodeRoot);

    expect(readdirSync(nodeRoot).sort()).toEqual(["LICENSE", "node.exe"]);
  });
});

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "ao-acp-runtime-test-"));
  temporaryDirectories.push(directory);
  return directory;
}
