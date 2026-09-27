import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildAoMcp } from "./build-ao-mcp.mjs";

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("buildAoMcp", () => {
  it("emits a bundled index.js into the output directory", async () => {
    const outputDir = mkdtempSync(join(tmpdir(), "ao-mcp-bundle-"));
    temporaryDirectories.push(outputDir);
    const outFile = await buildAoMcp({ outputDir });
    expect(outFile).toBe(join(outputDir, "index.js"));
    expect(existsSync(outFile)).toBe(true);
    const source = readFileSync(outFile, "utf8");
    expect(source).toContain("print-config");
    expect(existsSync(join(outputDir, "package.json"))).toBe(true);
  }, 120_000);
});
