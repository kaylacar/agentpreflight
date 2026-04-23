import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { applyStateUpdate, mergeTemplateData, scaffoldEditorial } from "../setup/editorial-setup.mjs";

describe("editorial setup scaffold", () => {
  it("merges template additions without overwriting existing values", () => {
    const merged = mergeTemplateData(
      {
        artifact: "homepage_copy",
        banned: ["system"],
        editorialChecks: { enabled: false },
      },
      {
        artifact: "landing_page",
        banned: ["modular"],
        editorialChecks: { enabled: true, enforceOnResponseTools: true },
      }
    );

    expect(merged).toEqual({
      artifact: "homepage_copy",
      banned: ["system", "modular"],
      editorialChecks: { enabled: false, enforceOnResponseTools: true },
    });
  });

  it("updates existing scaffold files with missing template keys", () => {
    const dir = mkdtempSync(join(tmpdir(), "preflight-editorial-setup-"));
    try {
      const preflightDir = join(dir, ".preflight");
      mkdirSync(preflightDir, { recursive: true });
      writeFileSync(
        join(preflightDir, "editorial-state.json"),
        JSON.stringify(
          {
            artifact: "homepage_copy",
            banned: ["system"],
          },
          null,
          2
        ),
        "utf8"
      );
      writeFileSync(
        join(preflightDir, "editorial.preflight.policy.json"),
        JSON.stringify(
          {
            name: "editorial",
            enabledRuleSets: ["editorial"],
            editorialChecks: {
              enabled: true,
            },
          },
          null,
          2
        ),
        "utf8"
      );

      const result = scaffoldEditorial(dir);
      expect(result.stateStatus).toBe("updated");
      expect(result.policyStatus).toBe("updated");

      const state = JSON.parse(readFileSync(join(preflightDir, "editorial-state.json"), "utf8"));
      const policy = JSON.parse(readFileSync(join(preflightDir, "editorial.preflight.policy.json"), "utf8"));

      expect(state.banned).toContain("system");
      expect(state.requiredConcepts).toBeDefined();
      expect(policy.editorialChecks.stateFile).toBe(".preflight/editorial-state.json");
      expect(policy.editorialChecks.enforceOnResponseTools).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("backs up and repairs an existing scaffold file with invalid JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "preflight-editorial-setup-invalid-"));
    try {
      const preflightDir = join(dir, ".preflight");
      mkdirSync(preflightDir, { recursive: true });
      writeFileSync(join(preflightDir, "editorial-state.json"), "{bad json", "utf8");

      const result = scaffoldEditorial(dir);
      expect(result.stateStatus).toBe("repaired");
      expect(result.stateBackupPath).toBeDefined();
      expect(existsSync(String(result.stateBackupPath))).toBe(true);
      expect(readFileSync(String(result.stateBackupPath), "utf8")).toBe("{bad json");

      const repaired = JSON.parse(readFileSync(join(preflightDir, "editorial-state.json"), "utf8"));
      expect(repaired.requiredConcepts).toBeDefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("adds locked, banned, required, and open entries through the setup flow", () => {
    const dir = mkdtempSync(join(tmpdir(), "preflight-editorial-setup-add-"));
    try {
      const result = scaffoldEditorial(dir, {
        artifact: "homepage_copy",
        locked: ["no ecosystem section"],
        banned: ["How It Works"],
        requiredConcepts: ["control"],
        open: ["cta wording"],
      });
      expect(result.stateUpdateStatus).toBe("updated");

      const state = JSON.parse(readFileSync(join(dir, ".preflight", "editorial-state.json"), "utf8"));
      expect(state.artifact).toBe("homepage_copy");
      expect(state.locked).toContain("no ecosystem section");
      expect(state.banned).toContain("How It Works");
      expect(state.requiredConcepts).toContain("control");
      expect(state.open).toContain("cta wording");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("applyStateUpdate does not duplicate entries", () => {
    const dir = mkdtempSync(join(tmpdir(), "preflight-editorial-setup-dedupe-"));
    try {
      const preflightDir = join(dir, ".preflight");
      mkdirSync(preflightDir, { recursive: true });
      writeFileSync(
        join(preflightDir, "editorial-state.json"),
        JSON.stringify({ locked: ["control"], banned: ["How It Works"] }, null, 2),
        "utf8"
      );
      const result = applyStateUpdate(join(preflightDir, "editorial-state.json"), {
        locked: ["control", "access"],
        banned: ["How It Works"],
      });
      expect(result.status).toBe("updated");
      expect(result.state.locked).toEqual(["control", "access"]);
      expect(result.state.banned).toEqual(["How It Works"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
