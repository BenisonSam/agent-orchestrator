import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DaemonClient } from "./client.js";
import {
  createTaskSchema,
  createToolHandlers,
  listTasksSchema,
  updateTaskSchema,
} from "./tools.js";

export function createAoMcpServer(
  client: DaemonClient = new DaemonClient(),
): McpServer {
  const server = new McpServer({
    name: "ao",
    version: "0.1.0",
  });
  const handlers = createToolHandlers(client);

  server.tool(
    "list_tasks",
    "List AO Kanban board tasks (worker sessions). Columns are derived read-only fields.",
    listTasksSchema,
    async (args) => handlers.list_tasks(args),
  );

  server.tool(
    "create_task",
    "Create a board task. With project_id, delegates via the project orchestrator; without it, spawns a standalone worker.",
    createTaskSchema,
    async (args) => handlers.create_task(args),
  );

  server.tool(
    "update_task",
    "Rename a board task (PATCH displayName). Does not move Kanban columns — those are derived from session facts.",
    updateTaskSchema,
    async (args) => handlers.update_task(args),
  );

  return server;
}
