import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  candidateRunfilePaths,
  discoverRunfile,
  readRunfile,
  resolveRunfilePath,
} from "./runfile.js";

describe("candidateRunfilePaths", () => {
  it("defaults to packaged then isolated-dev", () => {
    const paths = candidateRunfilePaths({}).map((p) => p.replaceAll("\\", "/"));
    expect(paths).toHaveLength(2);
    expect(paths[0]).toMatch(/\.ao\/running\.json$/);
    expect(paths[1]).toMatch(/\.ao\/dev\/running\.json$/);
  });

  it("honors AO_RUN_FILE absolute override alone", () => {
    const paths = candidateRunfilePaths({
      AO_RUN_FILE: "C:\\tmp\\running.json",
    });
    expect(paths).toEqual(["C:\\tmp\\running.json"]);
  });
});

describe("resolveRunfilePath", () => {
  it("returns the first candidate", () => {
    const path = resolveRunfilePath({});
    expect(path.replaceAll("\\", "/")).toMatch(/\.ao\/running\.json$/);
  });
});

describe("discoverRunfile", () => {
  it("returns null when the only candidate is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ao-mcp-"));
    await expect(
      discoverRunfile({ AO_RUN_FILE: join(dir, "missing.json") }),
    ).resolves.toBeNull();
  });

  it("reads an explicit AO_RUN_FILE when present", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ao-mcp-"));
    const path = join(dir, "running.json");
    await writeFile(path, JSON.stringify({ pid: 7, port: 3002 }), "utf8");
    await expect(discoverRunfile({ AO_RUN_FILE: path })).resolves.toEqual({
      path,
      info: { pid: 7, port: 3002 },
    });
  });
});

describe("readRunfile", () => {
  it("returns null when missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ao-mcp-"));
    await expect(readRunfile(join(dir, "missing.json"))).resolves.toBeNull();
  });

  it("parses a valid handshake", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ao-mcp-"));
    const path = join(dir, "running.json");
    await writeFile(path, JSON.stringify({ pid: 42, port: 3001 }), "utf8");
    await expect(readRunfile(path)).resolves.toEqual({ pid: 42, port: 3001 });
  });

  it("rejects invalid port", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ao-mcp-"));
    const path = join(dir, "running.json");
    await writeFile(path, JSON.stringify({ pid: 1, port: 0 }), "utf8");
    await expect(readRunfile(path)).rejects.toThrow(/invalid port/);
  });
});
