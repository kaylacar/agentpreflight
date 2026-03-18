import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createPreflight, replayToolCallsFromFile } from "../src/index.js";

describe("telemetry and ci replay", () => {
  it("writes telemetry jsonl rows", async () => {
    const dir = mkdtempSync(join(tmpdir(), "preflight-telemetry-"));
    try {
      const telemetryPath = join(dir, "telemetry.jsonl");
      const pf = createPreflight({ telemetryPath, rules: ["release"] });
      await pf.validate({
        tool: "final_response",
        params: { text: "done and live without proof" },
      });
      const lines = readFileSync(telemetryPath, "utf8").trim().split("\n");
      expect(lines.length).toBeGreaterThan(0);
      const row = JSON.parse(lines[0]) as { status: string };
      expect(row.status).toBe("blocked");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails ci replay when a call violates policy", async () => {
    const dir = mkdtempSync(join(tmpdir(), "preflight-ci-"));
    try {
      const path = join(dir, "calls.json");
      writeFileSync(
        path,
        JSON.stringify([{ tool: "final_response", params: { text: "done and fixed" } }], null, 2),
        "utf8"
      );
      const pf = createPreflight({ rules: ["release"], policyMode: "enforce" });
      const result = await replayToolCallsFromFile(pf, path);
      expect(result.failed).toBe(1);
      expect(result.passed).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
