import { describe, expect, it, vi } from "vitest";
import {
  OVERNIGHT_STATE_VERSION,
  resolveInitialOvernightState,
  type OvernightRunState,
} from "../src/overnight.js";
import { createPlatformExecutor, normalizeCommand } from "../src/command-executor.js";

describe("execution contract", () => {
  it("resets stale state when version mismatches", () => {
    const stale: OvernightRunState = {
      stateVersion: OVERNIGHT_STATE_VERSION - 1,
      status: "running",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      currentChunkIndex: 1,
      completedChunks: 1,
      chunks: [],
      blockers: [],
    };
    const resolved = resolveInitialOvernightState(stale, false);
    expect(resolved.initialState).toBeUndefined();
    expect(resolved.resetApplied).toBe(true);
  });

  it("resets when --reset is requested", () => {
    const state: OvernightRunState = {
      stateVersion: OVERNIGHT_STATE_VERSION,
      status: "running",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      currentChunkIndex: 1,
      completedChunks: 1,
      chunks: [],
      blockers: [],
    };
    const resolved = resolveInitialOvernightState(state, true);
    expect(resolved.initialState).toBeUndefined();
    expect(resolved.resetApplied).toBe(true);
  });

  it("normalizes commands per platform deterministically", () => {
    const win = normalizeCommand("win32", "echo ok");
    expect(win.file).toBe("cmd.exe");
    expect(win.args).toEqual(["/d", "/s", "/c", "echo ok"]);

    const unix = normalizeCommand("linux", "echo ok");
    expect(unix.file).toBe("sh");
    expect(unix.args).toEqual(["-lc", "echo ok"]);
  });

  it("maps spawn failure to non-zero result", async () => {
    vi.resetModules();
    vi.doMock("node:child_process", () => ({
      spawnSync: vi.fn(() => ({ status: null, error: new Error("EPERM"), stdout: "", stderr: "" })),
    }));
    const mod = await import("../src/command-executor.js");
    const exec = mod.createPlatformExecutor({ platform: "win32", stdout: () => {}, stderr: () => {} });
    const result = exec("echo ok");
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("EPERM");
  });
});
