import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { describe, expect, it } from "vitest";
import { DaemonClient } from "./client.js";

type Captured = {
  method: string;
  url: string;
  body: string;
};

async function withMockDaemon(
  handler: (
    req: IncomingMessage,
    res: ServerResponse,
    capture: Captured,
  ) => void,
  run: (client: DaemonClient, capture: Captured) => Promise<void>,
): Promise<void> {
  const capture: Captured = { method: "", url: "", body: "" };
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      capture.method = req.method ?? "";
      capture.url = req.url ?? "";
      capture.body = Buffer.concat(chunks).toString("utf8");
      handler(req, res, capture);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no address");
  const client = new DaemonClient({ baseUrl: `http://127.0.0.1:${addr.port}` });
  try {
    await run(client, capture);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
}

describe("DaemonClient", () => {
  it("lists worker tasks and filters orchestrators/terminated", async () => {
    await withMockDaemon(
      (_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            sessions: [
              {
                id: "w1",
                kind: "worker",
                displayName: "Fix login",
                kanbanColumn: "building",
                displayStatus: "Working",
                status: "working",
                isTerminated: false,
              },
              {
                id: "o1",
                kind: "orchestrator",
                displayName: "Orch",
                isTerminated: false,
              },
              {
                id: "w2",
                kind: "worker",
                displayName: "Done",
                isTerminated: true,
              },
            ],
          }),
        );
      },
      async (client, capture) => {
        const tasks = await client.listTasks({ projectId: "demo" });
        expect(capture.method).toBe("GET");
        expect(capture.url).toBe("/api/v1/sessions?project=demo");
        expect(tasks).toHaveLength(1);
        expect(tasks[0]).toMatchObject({
          id: "w1",
          title: "Fix login",
          kanbanColumn: "building",
        });
      },
    );
  });

  it("creates a project task via delegate", async () => {
    await withMockDaemon(
      (_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            workerId: "w-new",
            orchestratorId: "orch-1",
          }),
        );
      },
      async (client, capture) => {
        const result = await client.createTask({
          projectId: "demo",
          brief: "Add dark mode",
          agent: "codex",
        });
        expect(capture.method).toBe("POST");
        expect(capture.url).toBe("/api/v1/orchestrators/delegate");
        expect(JSON.parse(capture.body)).toMatchObject({
          projectId: "demo",
          brief: "Add dark mode",
          agent: "codex",
        });
        expect(result).toEqual({
          sessionId: "w-new",
          via: "delegate",
          orchestratorId: "orch-1",
        });
      },
    );
  });

  it("creates a standalone task via spawn", async () => {
    await withMockDaemon(
      (_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ session: { id: "standalone-1" } }));
      },
      async (client, capture) => {
        const result = await client.createTask({
          brief: "Explore idea",
          agent: "claude-code",
        });
        expect(capture.url).toBe("/api/v1/sessions");
        expect(JSON.parse(capture.body)).toMatchObject({
          kind: "worker",
          prompt: "Explore idea",
          harness: "claude-code",
        });
        expect(result).toEqual({ sessionId: "standalone-1", via: "spawn" });
      },
    );
  });

  it("renames a task", async () => {
    await withMockDaemon(
      (_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            sessionId: "w1",
            displayName: "New title",
          }),
        );
      },
      async (client, capture) => {
        const result = await client.updateTask({
          sessionId: "w1",
          displayName: "New title",
        });
        expect(capture.method).toBe("PATCH");
        expect(capture.url).toBe("/api/v1/sessions/w1");
        expect(JSON.parse(capture.body)).toEqual({ displayName: "New title" });
        expect(result).toEqual({
          ok: true,
          sessionId: "w1",
          displayName: "New title",
        });
      },
    );
  });

  it("surfaces daemon error envelopes", async () => {
    await withMockDaemon(
      (_req, res) => {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "not_found",
            code: "SESSION_NOT_FOUND",
            message: "Unknown session",
          }),
        );
      },
      async (client) => {
        await expect(
          client.updateTask({ sessionId: "missing", displayName: "x" }),
        ).rejects.toThrow(/Unknown session/);
      },
    );
  });
});
