import { describe, expect, it } from "vitest";
import { formatMcpConfig } from "./print-config.js";

describe("formatMcpConfig", () => {
  it("emits command-only mcpServers fragment", () => {
    const json = formatMcpConfig({
      command: "C:\\Users\\x\\.ao\\bin\\ao-mcp.cmd",
      wake: false,
    });
    expect(JSON.parse(json)).toEqual({
      mcpServers: {
        ao: { command: "C:\\Users\\x\\.ao\\bin\\ao-mcp.cmd" },
      },
    });
  });

  it("adds args [--wake] when wake true", () => {
    const json = formatMcpConfig({
      command: "/home/u/.ao/bin/ao-mcp",
      wake: true,
    });
    expect(JSON.parse(json).mcpServers.ao.args).toEqual(["--wake"]);
  });
});
