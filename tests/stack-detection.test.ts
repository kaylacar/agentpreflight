import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { autoDetectedRuleSets, detectProjectStacks } from "../src/stack-detection.js";

describe("stack detection", () => {
  it("detects node stack and enables node-focused rule sets", () => {
    const dir = mkdtempSync(join(tmpdir(), "preflight-stack-node-"));
    try {
      writeFileSync(join(dir, "package.json"), '{"name":"x"}', "utf8");
      const stacks = detectProjectStacks(dir);
      const rules = autoDetectedRuleSets(dir);
      expect(stacks.has("node")).toBe(true);
      expect(rules).toContain("network");
      expect(rules).toContain("parallel");
      expect(rules).toContain("prewrite");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back to base rules when no stack markers are found", () => {
    const dir = mkdtempSync(join(tmpdir(), "preflight-stack-none-"));
    try {
      const rules = autoDetectedRuleSets(dir);
      expect(rules).toContain("filesystem");
      expect(rules).toContain("secrets");
      expect(rules).not.toContain("network");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
