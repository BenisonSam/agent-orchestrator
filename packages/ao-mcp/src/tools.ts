import { z } from "zod";
import type { DaemonClient } from "./client.js";

export const listTasksSchema = {
  project_id: z
    .string()
    .optional()
    .describe(
      "Optional project id. When omitted, lists tasks across all projects.",
    ),
  include_terminated: z
    .boolean()
    .optional()
    .describe("Include terminated sessions. Defaults to false."),
  include_orchestrators: z
    .boolean()
    .optional()
    .describe(
      "Include orchestrator sessions. Defaults to false (worker board cards only).",
    ),
};

export const createTaskSchema = {
  brief: z
    .string()
    .min(1)
    .describe("Task brief / initial prompt for the worker."),
  project_id: z
    .string()
    .optional()
    .describe(
      "Project id for a board task (uses orchestrator delegate). Omit for a standalone worker spawn.",
    ),
  agent: z
    .string()
    .optional()
    .describe(
      "Worker harness (e.g. codex, claude-code). Project default used when omitted.",
    ),
  model: z
    .string()
    .optional()
    .describe("Optional model override for this spawn."),
  effort: z
    .string()
    .optional()
    .describe("Optional reasoning effort for the selected model."),
  mode: z
    .enum(["chat", "tui"])
    .optional()
    .describe("Conversation mode. Omit for daemon default."),
  approval_mode: z
    .string()
    .optional()
    .describe(
      "Optional permission mode override (default, accept-edits, auto, bypass-permissions).",
    ),
  display_name: z
    .string()
    .max(100)
    .optional()
    .describe(
      "Optional sidebar/board title (standalone spawn only; ignore for project delegate).",
    ),
};

export const updateTaskSchema = {
  session_id: z
    .string()
    .min(1)
    .describe("Session id of the board task (worker) to rename."),
  display_name: z
    .string()
    .min(1)
    .max(100)
    .describe(
      "New board/sidebar title. Kanban column is derived and cannot be set.",
    ),
};

function textResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function errorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true as const,
  };
}

export function createToolHandlers(client: DaemonClient) {
  return {
    async list_tasks(args: {
      project_id?: string;
      include_terminated?: boolean;
      include_orchestrators?: boolean;
    }) {
      try {
        const tasks = await client.listTasks({
          projectId: args.project_id,
          includeTerminated: args.include_terminated,
          includeOrchestrators: args.include_orchestrators,
        });
        return textResult({ tasks, count: tasks.length });
      } catch (err) {
        return errorResult(err);
      }
    },

    async create_task(args: {
      brief: string;
      project_id?: string;
      agent?: string;
      model?: string;
      effort?: string;
      mode?: "chat" | "tui";
      approval_mode?: string;
      display_name?: string;
    }) {
      try {
        const result = await client.createTask({
          brief: args.brief,
          projectId: args.project_id,
          agent: args.agent,
          model: args.model,
          effort: args.effort,
          mode: args.mode,
          approvalMode: args.approval_mode,
          displayName: args.display_name,
        });
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },

    async update_task(args: { session_id: string; display_name: string }) {
      try {
        const result = await client.updateTask({
          sessionId: args.session_id,
          displayName: args.display_name,
        });
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  };
}
