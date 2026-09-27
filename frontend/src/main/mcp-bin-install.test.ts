import { mkdtempSync, readFileSync, rmSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  installMcpBin,
  mcpShimPath,
  renderMcpLauncher,
  resolveMcpResourcePaths,
} from "./mcp-bin-install";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("mcp-bin-install", () => {
  it("renders a Windows cmd launcher with absolute paths", () => {
    const body = renderMcpLauncher({
      homeDir: "C:\\Users\\x",
      nodePath: "C:\\App\\resources\\acp-runtime\\node\\bin\\node.exe",
      scriptPath: "C:\\App\\resources\\ao-mcp\\index.js",
      platform: "win32",
    });
    expect(body).toContain("@echo off");
    expect(body).toContain(
      '"C:\\App\\resources\\acp-runtime\\node\\bin\\node.exe" "C:\\App\\resources\\ao-mcp\\index.js" %*',
    );
  });

  it("renders a unix shell launcher", () => {
    const body = renderMcpLauncher({
      homeDir: "/home/x",
      nodePath: "/App/resources/acp-runtime/node/bin/node",
      scriptPath: "/App/resources/ao-mcp/index.js",
      platform: "linux",
    });
    expect(body.startsWith("#!/bin/sh\n")).toBe(true);
    expect(body).toContain(
      'exec "/App/resources/acp-runtime/node/bin/node" "/App/resources/ao-mcp/index.js" "$@"',
    );
  });

  it("writes ~/.ao/bin/ao-mcp.cmd on win32", async () => {
    const homeDir = mkdtempSync(path.join(tmpdir(), "ao-mcp-bin-"));
    temporaryDirectories.push(homeDir);
    const resources = path.join(homeDir, "resources");
    mkdirSync(path.join(resources, "acp-runtime", "node", "bin"), {
      recursive: true,
    });
    mkdirSync(path.join(resources, "ao-mcp"), { recursive: true });
    const nodePath = path.join(resources, "acp-runtime", "node", "bin", "node.exe");
    const scriptPath = path.join(resources, "ao-mcp", "index.js");
    writeFileSync(nodePath, "");
    writeFileSync(scriptPath, "console.log(1)");

    const shim = await installMcpBin({
      homeDir,
      nodePath,
      scriptPath,
      platform: "win32",
    });
    expect(shim).toBe(mcpShimPath(homeDir, "win32"));
    expect(existsSync(shim)).toBe(true);
    expect(readFileSync(shim, "utf8")).toContain(nodePath);
    expect(readFileSync(shim, "utf8")).toContain(scriptPath);
  });

  it("resolves resource paths under the resources root", () => {
    const resolved = resolveMcpResourcePaths({
      resourcesRoot: "/App/Resources",
      platform: "darwin",
    });
    expect(resolved.nodePath.replace(/\\/g, "/")).toBe(
      "/App/Resources/acp-runtime/node/bin/node",
    );
    expect(resolved.scriptPath.replace(/\\/g, "/")).toBe(
      "/App/Resources/ao-mcp/index.js",
    );
  });
});
