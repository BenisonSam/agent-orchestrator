import { describe, expect, it } from "vitest";
import { defaultShimPath, parseCli } from "./cli.js";

describe("parseCli", () => {
  it("defaults to serve with wake off", () => {
    expect(parseCli([], {})).toEqual({ mode: "serve", wake: false });
  });

  it("enables wake from --wake", () => {
    expect(parseCli(["--wake"], {})).toEqual({ mode: "serve", wake: true });
  });

  it("enables wake from AO_MCP_WAKE=1", () => {
    expect(parseCli([], { AO_MCP_WAKE: "1" })).toEqual({
      mode: "serve",
      wake: true,
    });
  });

  it("enables wake from AO_MCP_WAKE=true", () => {
    expect(parseCli([], { AO_MCP_WAKE: "true" })).toEqual({
      mode: "serve",
      wake: true,
    });
  });

  it("parses print-config [--wake]", () => {
    expect(parseCli(["print-config"], {})).toEqual({
      mode: "print-config",
      wake: false,
    });
    expect(parseCli(["print-config", "--wake"], {})).toEqual({
      mode: "print-config",
      wake: true,
    });
  });
});

describe("defaultShimPath", () => {
  it("uses ao-mcp.cmd on win32", () => {
    expect(defaultShimPath("C:\\Users\\x", "win32")).toMatch(/ao-mcp\.cmd$/);
  });

  it("uses ao-mcp on unix", () => {
    expect(defaultShimPath("/home/x", "linux")).toBe("/home/x/.ao/bin/ao-mcp");
  });
});
