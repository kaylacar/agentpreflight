import { describe, expect, it } from "vitest";
import { adaptToolCall, createPreflight } from "../src/index.js";

describe("policy modes and adapters", () => {
  it("adapts claude schema to tool call", () => {
    const call = adaptToolCall(
      {
        tool_name: "Bash",
        tool_input: { command: "git push --force origin master" },
      },
      "claude"
    );
    expect(call.tool).toBe("Bash");
    expect(call.params.command).toBe("git push --force origin master");
    expect(call.source).toBe("claude");
  });

  it("warn-only mode downgrades failures", async () => {
    const pf = createPreflight({ rules: ["release"], policyMode: "warn-only" });
    const results = await pf.validateWithPolicy({
      tool: "final_response",
      params: { text: "done and live" },
    });
    expect(results.some((r) => r.rule === "release-claim-requires-evidence" && r.status === "warn")).toBe(true);
  });

  it("audit-only mode downgrades failures", async () => {
    const pf = createPreflight({ rules: ["release"], policyMode: "audit-only" });
    const results = await pf.validateWithPolicy({
      tool: "final_response",
      params: { text: "done and live" },
    });
    expect(results.some((r) => r.rule === "release-claim-requires-evidence" && r.status === "warn")).toBe(true);
  });

  it("preflightCommand returns safe patch for force push", async () => {
    const pf = createPreflight({ rules: ["git"] });
    const out = await pf.preflightCommand({
      tool: "bash",
      params: { command: "git push --force origin feature-x" },
    });
    expect(out.blocked).toBe(false);
    expect(String(out.patchedCall?.params.command || "")).toContain("--force-with-lease");
  });
});
