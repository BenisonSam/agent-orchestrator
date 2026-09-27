#!/usr/bin/env node
import { homedir } from "node:os";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { defaultShimPath, parseCli } from "./cli.js";
import { DaemonClient } from "./client.js";
import { formatMcpConfig } from "./print-config.js";
import { createAoMcpServer } from "./server.js";

async function main(): Promise<void> {
  const cli = parseCli(process.argv.slice(2), process.env);

  if (cli.mode === "print-config") {
    const command = defaultShimPath(homedir(), process.platform);
    process.stdout.write(formatMcpConfig({ command, wake: cli.wake }));
    return;
  }

  const client = new DaemonClient({ wake: cli.wake });
  const server = createAoMcpServer(client);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
