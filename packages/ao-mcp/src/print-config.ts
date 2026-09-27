export type McpConfigOptions = {
  command: string;
  wake: boolean;
};

/** Host-agnostic mcpServers JSON fragment for paste into any MCP client. */
export function formatMcpConfig(opts: McpConfigOptions): string {
  const entry: { command: string; args?: string[] } = {
    command: opts.command,
  };
  if (opts.wake) {
    entry.args = ["--wake"];
  }
  return `${JSON.stringify({ mcpServers: { ao: entry } }, null, 2)}\n`;
}
