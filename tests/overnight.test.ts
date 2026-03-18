import { describe, expect, it } from "vitest";
import { runOvernightPlan, type CommandRunResult, type OvernightPlan } from "../src/overnight.js";

function passPreflight() {
  return {
    async preflightCommand(call: { params: { command?: string } }) {
      return { results: [{ status: "pass", rule: "mock", message: "ok" }], blocked: false, patchedCall: call };
    },
  };
}

describe("overnight runner", () => {
  it("completes all chunks when commands and gates pass", async () => {
    const plan: OvernightPlan = {
      name: "ok",
      gates: ["gate-ok"],
      chunks: [
        { id: "c1", objective: "first", steps: [{ command: "step-1" }] },
        { id: "c2", objective: "second", steps: [{ command: "step-2" }] },
      ],
    };
    const executed: string[] = [];
    const executor = (command: string): CommandRunResult => {
      executed.push(command);
      return { code: 0, stdout: "ok", stderr: "" };
    };

    const state = await runOvernightPlan(plan, {
      preflight: passPreflight() as never,
      executor,
    });

    expect(state.status).toBe("completed");
    expect(state.completedChunks).toBe(2);
    expect(executed).toEqual(["step-1", "gate-ok", "step-2", "gate-ok"]);
  });

  it("blocks after max attempts when a command keeps failing", async () => {
    const plan: OvernightPlan = {
      name: "fail",
      maxAttemptsPerChunk: 2,
      stopOnFailure: true,
      chunks: [{ id: "c1", objective: "break", steps: [{ command: "bad-step" }] }],
    };
    let runs = 0;
    const executor = (_command: string): CommandRunResult => {
      runs += 1;
      return { code: 1, stderr: "boom" };
    };

    const state = await runOvernightPlan(plan, {
      preflight: passPreflight() as never,
      executor,
    });

    expect(state.status).toBe("blocked");
    expect(state.blockers.length).toBe(1);
    expect(state.chunks[0].attempts).toBe(2);
    expect(runs).toBe(2);
  });
});
