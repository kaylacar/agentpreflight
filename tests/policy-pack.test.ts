import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createPreflight, loadBaselinePolicyTemplate } from "../src/index.js";

describe("policy pack rule-set enforcement", () => {
  it("uses enabledRuleSets from policy pack when options.rules is not set", async () => {
    const dir = mkdtempSync(join(tmpdir(), "preflight-policy-"));
    try {
      const policyPath = join(dir, "preflight.policy.json");
      writeFileSync(
        policyPath,
        JSON.stringify(
          {
            mode: "enforce",
            enabledRuleSets: ["release"],
          },
          null,
          2
        ),
        "utf8"
      );

      const pf = createPreflight({ policyPackPath: policyPath });
      const results = await pf.validate({
        tool: "final_response",
        params: { text: "done and fixed" },
      });
      expect(results.some((r) => r.rule === "release-claim-requires-evidence")).toBe(true);
      // If non-release defaults were loaded, we'd often get extra unrelated matches on other calls.
      expect(results.length).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("loads the editorial baseline template from the shipped package templates", async () => {
    const policy = await loadBaselinePolicyTemplate("editorial");
    expect(policy.name).toBe("editorial");
    expect(policy.enabledRuleSets).toContain("editorial");
    expect(policy.responseChecks?.enabled).toBe(true);
  });
});
