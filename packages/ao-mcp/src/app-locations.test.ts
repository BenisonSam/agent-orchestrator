import { describe, expect, it } from "vitest";
import { knownAppLocations, resolveInstalledApp } from "./app-locations.js";

describe("knownAppLocations", () => {
  it("lists Windows NSIS per-user then Program Files", () => {
    const paths = knownAppLocations(
      "win32",
      {
        LOCALAPPDATA: "C:\\Users\\x\\AppData\\Local",
        ProgramFiles: "C:\\Program Files",
      },
      "C:\\Users\\x",
    );
    expect(paths).toEqual([
      "C:\\Users\\x\\AppData\\Local\\Programs\\Agent Orchestrator\\agent-orchestrator.exe",
      "C:\\Program Files\\Agent Orchestrator\\agent-orchestrator.exe",
    ]);
  });

  it("lists macOS Applications paths", () => {
    expect(knownAppLocations("darwin", {}, "/Users/x")).toEqual([
      "/Applications/Agent Orchestrator.app",
      "/Users/x/Applications/Agent Orchestrator.app",
    ]);
  });

  it("lists Linux AppImage paths under ~/.ao and ~/Applications", () => {
    expect(knownAppLocations("linux", {}, "/home/x")).toEqual([
      "/home/x/.ao/agent-orchestrator.AppImage",
      "/home/x/Applications/agent-orchestrator.AppImage",
    ]);
  });
});

describe("resolveInstalledApp", () => {
  it("returns first existing candidate", () => {
    const found = resolveInstalledApp(
      "linux",
      {},
      "/home/x",
      (p) => p.endsWith("Applications/agent-orchestrator.AppImage"),
    );
    expect(found).toBe("/home/x/Applications/agent-orchestrator.AppImage");
  });

  it("returns null when nothing exists", () => {
    expect(resolveInstalledApp("linux", {}, "/home/x", () => false)).toBeNull();
  });
});
