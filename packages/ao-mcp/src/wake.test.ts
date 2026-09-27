import { describe, expect, it, vi } from "vitest";
import {
  ensureDaemonReady,
  noInstallMessage,
  wakeTimeoutMessage,
  WAKE_TIMEOUT_MS,
} from "./wake.js";
import { noDaemonMessage } from "./runfile.js";

describe("ensureDaemonReady", () => {
  it("returns base URL when daemon already healthy without launching", async () => {
    const launch = vi.fn();
    const base = await ensureDaemonReady(true, {
      discover: async () => ({
        path: "/tmp/running.json",
        info: { pid: 1, port: 3001 },
      }),
      fetchImpl: (async () =>
        new Response(null, { status: 200 })) as typeof fetch,
      launch,
    });
    expect(base).toBe("http://127.0.0.1:3001");
    expect(launch).not.toHaveBeenCalled();
  });

  it("fails immediately when wake is off and no daemon", async () => {
    await expect(
      ensureDaemonReady(false, {
        env: {},
        discover: async () => null,
        homeDir: "/home/x",
      }),
    ).rejects.toThrow(/AO daemon is not running/);
  });

  it("fails with no-install when wake on but no bundle", async () => {
    await expect(
      ensureDaemonReady(true, {
        discover: async () => null,
        resolveApp: () => null,
      }),
    ).rejects.toThrow(noInstallMessage());
  });

  it("launches once then succeeds after daemon appears", async () => {
    let calls = 0;
    const launch = vi.fn();
    const base = await ensureDaemonReady(true, {
      discover: async () => {
        calls += 1;
        if (calls < 3) return null;
        return { path: "/tmp/running.json", info: { pid: 1, port: 3002 } };
      },
      fetchImpl: (async () =>
        new Response(null, { status: 200 })) as typeof fetch,
      resolveApp: () => "/Apps/Agent Orchestrator.app",
      launch,
      sleep: async () => undefined,
      timeoutMs: 5_000,
      pollMs: 1,
    });
    expect(base).toBe("http://127.0.0.1:3002");
    expect(launch).toHaveBeenCalledTimes(1);
    expect(launch).toHaveBeenCalledWith("/Apps/Agent Orchestrator.app");
  });

  it("times out when daemon never becomes ready", async () => {
    let t = 0;
    await expect(
      ensureDaemonReady(true, {
        discover: async () => null,
        resolveApp: () => "/app.exe",
        launch: () => undefined,
        sleep: async () => undefined,
        now: () => {
          const cur = t;
          t += WAKE_TIMEOUT_MS;
          return cur;
        },
        timeoutMs: WAKE_TIMEOUT_MS,
        pollMs: 1,
      }),
    ).rejects.toThrow(wakeTimeoutMessage(WAKE_TIMEOUT_MS));
  });

  it("includes tried paths in no-wake error", async () => {
    await expect(
      ensureDaemonReady(false, {
        env: { AO_RUN_FILE: "/custom/running.json" },
        discover: async () => null,
      }),
    ).rejects.toThrow(noDaemonMessage(["/custom/running.json"]));
  });
});
