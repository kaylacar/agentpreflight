import { describe, expect, it } from "vitest";
import { createPreflight } from "../src/index.js";

describe("prewrite external checks", () => {
  it("fails when configured lint command fails", async () => {
    const pf = createPreflight({
      rules: ["prewrite"],
      policyPack: {
        prewriteChecks: {
          enabled: true,
          lintCommand: "fake-lint",
          applyToExtensions: [".ts"],
        },
      },
      exec: async () => {
        throw new Error("lint failed");
      },
    });

    const results = await pf.validate({
      tool: "write_file",
      params: { path: "src/a.ts", content: "const a = 1;" },
    });
    expect(results.some((r) => r.rule === "prewrite-external-checks" && r.status === "fail")).toBe(true);
  });

  it("passes when extension is excluded", async () => {
    const pf = createPreflight({
      rules: ["prewrite"],
      policyPack: {
        prewriteChecks: {
          enabled: true,
          lintCommand: "fake-lint",
          applyToExtensions: [".ts"],
        },
      },
      exec: async () => {
        throw new Error("should not run");
      },
    });

    const results = await pf.validate({
      tool: "write_file",
      params: { path: "README.md", content: "ok" },
    });
    expect(results.some((r) => r.rule === "prewrite-external-checks" && r.status === "pass")).toBe(true);
  });
});
