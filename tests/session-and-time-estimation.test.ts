import { describe, expect, it } from "vitest";
import { createPreflight } from "../src/index.js";

describe("session + time estimation rules", () => {
  it("blocks destructive command without session token", async () => {
    const pf = createPreflight({ rules: ["session"] });
    const results = await pf.validate({
      tool: "bash",
      params: { command: "rm -rf build/" },
    });
    expect(results.some((r) => r.rule === "session-destructive-checkpoint" && r.status === "fail")).toBe(true);
  });

  it("passes destructive command with session token", async () => {
    const pf = createPreflight({ rules: ["session"], sessionToken: "ok" });
    const results = await pf.validate({
      tool: "bash",
      params: { command: "rm -rf build/" },
    });
    expect(results.some((r) => r.rule === "session-destructive-checkpoint" && r.status === "pass")).toBe(true);
  });

  it("fails missing estimate schema", async () => {
    const pf = createPreflight({ rules: ["time-estimation"] });
    const results = await pf.validate({
      tool: "estimate",
      params: { estimate_text: "quick fix maybe a few hours" },
    });
    expect(results.some((r) => r.rule === "time-estimation-schema" && r.status === "fail")).toBe(true);
  });

  it("fails when calibration is required but missing", async () => {
    const pf = createPreflight({
      rules: ["time-estimation"],
      policyPack: { requireCalibrationOnEstimates: true },
    });
    const results = await pf.validate({
      tool: "estimate",
      params: {
        scope: "phase 2",
        assumptions: "no blockers",
        best_case_minutes: 30,
        p90_minutes: 60,
        confidence: 0.6,
      },
    });
    expect(results.some((r) => r.rule === "time-estimation-calibration-required" && r.status === "fail")).toBe(true);
  });
});
