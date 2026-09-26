import {
  candidateRunfilePaths,
  discoverRunfile,
  noDaemonMessage,
} from "./runfile.js";

export type ApiErrorBody = {
  error?: string;
  code?: string;
  message?: string;
  requestId?: string;
};

export class DaemonApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly requestId?: string;

  constructor(
    status: number,
    body: ApiErrorBody | undefined,
    fallback: string,
  ) {
    const message = body?.message || body?.error || fallback;
    super(message);
    this.name = "DaemonApiError";
    this.status = status;
    this.code = body?.code;
    this.requestId = body?.requestId;
  }
}

/** Compact board-facing view of a worker session ("task"). */
export type TaskSummary = {
  id: string;
  projectId?: string;
  title: string;
  kind: string;
  harness?: string;
  status?: string;
  kanbanColumn?: string;
  displayStatus?: string;
  branch?: string;
  isTerminated: boolean;
  updatedAt?: string;
};

export type ListTasksInput = {
  projectId?: string;
  /** When true, include terminated sessions. Default false. */
  includeTerminated?: boolean;
  /** When true, include orchestrators. Default false (workers only). */
  includeOrchestrators?: boolean;
};

export type CreateTaskInput = {
  /** Required for project board tasks. Omit for a standalone worker. */
  projectId?: string;
  brief: string;
  agent?: string;
  model?: string;
  effort?: string;
  mode?: "chat" | "tui";
  approvalMode?: string;
  displayName?: string;
};

export type CreateTaskResult = {
  sessionId: string;
  via: "delegate" | "spawn";
  orchestratorId?: string;
};

export type UpdateTaskInput = {
  sessionId: string;
  displayName: string;
};

export type UpdateTaskResult = {
  ok: boolean;
  sessionId: string;
  displayName: string;
};

type WireSession = {
  id: string;
  projectId?: string;
  kind?: string;
  harness?: string;
  displayName?: string;
  status?: string;
  kanbanColumn?: string;
  displayStatus?: string;
  branch?: string;
  isTerminated?: boolean;
  updatedAt?: string;
};

type DaemonClientOptions = {
  /** Override base URL (tests). When set, run-file discovery is skipped. */
  baseUrl?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
};

/**
 * Thin loopback HTTP client for the AO daemon task/board surface.
 * Discovers the bound port from running.json unless AO_BASE_URL is set.
 */
export class DaemonClient {
  private readonly env: NodeJS.ProcessEnv;
  private readonly fetchImpl: typeof fetch;
  private readonly fixedBaseUrl?: string;

  constructor(options: DaemonClientOptions = {}) {
    this.env = options.env ?? process.env;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.fixedBaseUrl =
      options.baseUrl ?? this.env.AO_BASE_URL?.replace(/\/+$/, "");
  }

  async baseUrl(): Promise<string> {
    if (this.fixedBaseUrl) return this.fixedBaseUrl;
    const found = await discoverRunfile(this.env);
    if (!found) {
      throw new Error(noDaemonMessage(candidateRunfilePaths(this.env)));
    }
    return `http://127.0.0.1:${found.info.port}`;
  }

  async listTasks(input: ListTasksInput = {}): Promise<TaskSummary[]> {
    const params = new URLSearchParams();
    if (input.projectId?.trim()) params.set("project", input.projectId.trim());
    const qs = params.toString();
    const path = qs ? `/api/v1/sessions?${qs}` : "/api/v1/sessions";
    const body = await this.request<{ sessions?: WireSession[] }>("GET", path);
    const sessions = body.sessions ?? [];
    const includeTerminated = input.includeTerminated === true;
    const includeOrchestrators = input.includeOrchestrators === true;
    return sessions
      .filter((s) => {
        if (!includeTerminated && s.isTerminated) return false;
        if (!includeOrchestrators && s.kind === "orchestrator") return false;
        return true;
      })
      .map(toTaskSummary);
  }

  async createTask(input: CreateTaskInput): Promise<CreateTaskResult> {
    const brief = input.brief.trim();
    if (!brief) throw new Error("brief is required");

    const projectId = input.projectId?.trim();
    if (projectId) {
      const payload: Record<string, unknown> = {
        projectId,
        brief,
      };
      if (input.agent) payload.agent = input.agent;
      if (input.model) payload.model = input.model;
      if (input.effort !== undefined) payload.effort = input.effort;
      if (input.mode) payload.mode = input.mode;
      if (input.approvalMode) payload.approvalMode = input.approvalMode;

      const res = await this.request<{
        workerId?: string;
        orchestratorId?: string;
      }>("POST", "/api/v1/orchestrators/delegate", payload);
      if (!res.workerId)
        throw new Error("delegate succeeded but returned no workerId");
      return {
        sessionId: res.workerId,
        via: "delegate",
        orchestratorId: res.orchestratorId,
      };
    }

    const displayName =
      input.displayName?.trim().slice(0, 100) ||
      brief.slice(0, 100) ||
      input.agent ||
      "Standalone agent";
    const payload: Record<string, unknown> = {
      kind: "worker",
      prompt: brief,
      displayName,
    };
    if (input.agent) payload.harness = input.agent;
    if (input.model) payload.model = input.model;
    if (input.effort) payload.effort = input.effort;
    if (input.mode) payload.mode = input.mode;
    if (input.approvalMode) payload.approvalMode = input.approvalMode;

    const res = await this.request<{ session?: { id?: string } }>(
      "POST",
      "/api/v1/sessions",
      payload,
    );
    const id = res.session?.id;
    if (!id) throw new Error("spawn succeeded but returned no session id");
    return { sessionId: id, via: "spawn" };
  }

  async updateTask(input: UpdateTaskInput): Promise<UpdateTaskResult> {
    const sessionId = input.sessionId.trim();
    const displayName = input.displayName.trim();
    if (!sessionId) throw new Error("sessionId is required");
    if (!displayName) throw new Error("displayName is required");
    if ([...displayName].length > 100) {
      throw new Error("displayName must be 100 characters or fewer");
    }

    const res = await this.request<{
      ok?: boolean;
      sessionId?: string;
      displayName?: string;
    }>("PATCH", `/api/v1/sessions/${encodeURIComponent(sessionId)}`, {
      displayName,
    });
    return {
      ok: res.ok !== false,
      sessionId: res.sessionId ?? sessionId,
      displayName: res.displayName ?? displayName,
    };
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const base = await this.baseUrl();
    const url = `${base}${path}`;
    const init: RequestInit = {
      method,
      headers: { Accept: "application/json" },
    };
    if (body !== undefined) {
      init.headers = {
        Accept: "application/json",
        "Content-Type": "application/json",
      };
      init.body = JSON.stringify(body);
    }
    const res = await this.fetchImpl(url, init);
    const text = await res.text();
    let parsed: unknown;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
    }
    if (!res.ok) {
      throw new DaemonApiError(
        res.status,
        parsed as ApiErrorBody | undefined,
        `${method} ${path} failed (${res.status})`,
      );
    }
    return (parsed ?? {}) as T;
  }
}

function toTaskSummary(s: WireSession): TaskSummary {
  return {
    id: s.id,
    projectId: s.projectId,
    title: s.displayName?.trim() || s.id,
    kind: s.kind ?? "worker",
    harness: s.harness,
    status: s.status,
    kanbanColumn: s.kanbanColumn,
    displayStatus: s.displayStatus,
    branch: s.branch,
    isTerminated: !!s.isTerminated,
    updatedAt: s.updatedAt,
  };
}
