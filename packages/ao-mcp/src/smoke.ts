/**
 * Smoke: start ao-mcp over stdio, list tools, call list_tasks against the live daemon.
 * Run: node --experimental-vm-modules node_modules/vitest/vitest.mjs  ... no, plain:
 *   node dist/smoke.js  after build, or tsx — we'll compile it as scripts/smoke.mts via node on dist.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const serverEntry = join(root, "index.js");

async function main(): Promise<void> {
  const childEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) childEnv[key] = value;
  }
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    stderr: "pipe",
    // Forward discovery overrides into the MCP child (stdio servers may not
    // inherit the parent env from the SDK on all hosts).
    env: childEnv,
  });
  const client = new Client({ name: "ao-mcp-smoke", version: "0.1.0" });
  await client.connect(transport);

  const tools = await client.listTools();
  const names = tools.tools.map((t) => t.name).sort();
  console.log("tools:", names.join(", "));
  if (names.join(",") !== "create_task,list_tasks,update_task") {
    throw new Error(`unexpected tools: ${names.join(",")}`);
  }

  const listed = await client.callTool({ name: "list_tasks", arguments: {} });
  const text = Array.isArray(listed.content)
    ? listed.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("\n")
    : "";
  console.log("list_tasks:", text.slice(0, 500));
  if (listed.isError) {
    throw new Error(`list_tasks failed: ${text}`);
  }
  const parsed = JSON.parse(text) as { count: number; tasks: unknown[] };
  if (typeof parsed.count !== "number" || !Array.isArray(parsed.tasks)) {
    throw new Error(`unexpected list_tasks payload: ${text}`);
  }
  console.log(`ok: ${parsed.count} task(s)`);

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
