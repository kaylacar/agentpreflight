import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadTemplate(path: string) {
  return JSON.parse(readFileSync(resolve(process.cwd(), path), "utf8")) as Record<string, unknown>;
}

describe("policy template contract", () => {
  const templatePaths = [
    "templates/startup-safe.preflight.policy.json",
    "templates/enterprise.preflight.policy.json",
    "templates/speed.preflight.policy.json",
  ];

  for (const templatePath of templatePaths) {
    it(`keeps required policy fields: ${templatePath}`, () => {
      const tpl = loadTemplate(templatePath);
      expect(typeof tpl.name).toBe("string");
      expect(["enforce", "warn-only", "audit-only"]).toContain(tpl.mode);
      expect(Array.isArray(tpl.enabledRuleSets)).toBe(true);
      expect(typeof tpl.destructiveRequireToken).toBe("boolean");
      expect(Array.isArray(tpl.autoPatchAllowedRules)).toBe(true);
      expect(typeof tpl.requireCalibrationOnEstimates).toBe("boolean");
      expect(typeof tpl.prewriteChecks).toBe("object");
    });
  }
});
