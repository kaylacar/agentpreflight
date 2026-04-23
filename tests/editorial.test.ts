import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createPreflight } from "../src/index.js";

function makePolicy() {
  return {
    enabledRuleSets: ["editorial"],
    editorialChecks: {
      enabled: true,
      stateFile: ".preflight/editorial-state.json",
      enforceOnResponseTools: true,
      enforceOnWriteTools: true,
    },
  };
}

describe("editorial rules", () => {
  it("fails when the editorial state file is missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "preflight-editorial-missing-"));
    try {
      const pf = createPreflight({ cwd: dir, policyPack: makePolicy() });
      const results = await pf.validate({
        tool: "final_response",
        params: { text: "control access inbound follow-through" },
      });
      expect(results.find((r) => r.rule === "editorial-state-file-present")?.status).toBe("fail");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails when banned language is present", async () => {
    const dir = mkdtempSync(join(tmpdir(), "preflight-editorial-banned-"));
    try {
      mkdirSync(join(dir, ".preflight"), { recursive: true });
      writeFileSync(
        join(dir, ".preflight", "editorial-state.json"),
        JSON.stringify(
          {
            locked: ["control"],
            banned: ["system"],
            requiredConcepts: ["inbound"],
          },
          null,
          2
        ),
        "utf8"
      );

      const pf = createPreflight({ cwd: dir, policyPack: makePolicy() });
      const results = await pf.validate({
        tool: "final_response",
        params: { text: "This system gives you control over inbound." },
      });
      expect(results.find((r) => r.rule === "editorial-banned-language")?.status).toBe("fail");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails when required concepts are missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "preflight-editorial-required-"));
    try {
      mkdirSync(join(dir, ".preflight"), { recursive: true });
      writeFileSync(
        join(dir, ".preflight", "editorial-state.json"),
        JSON.stringify(
          {
            locked: ["control"],
            requiredConcepts: ["inbound", "follow-through"],
          },
          null,
          2
        ),
        "utf8"
      );

      const pf = createPreflight({ cwd: dir, policyPack: makePolicy() });
      const results = await pf.validate({
        tool: "final_response",
        params: { text: "The draft mentions control and inbound but not the rest." },
      });
      expect(results.find((r) => r.rule === "editorial-required-coverage")?.status).toBe("fail");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("passes when locked and required concepts are covered", async () => {
    const dir = mkdtempSync(join(tmpdir(), "preflight-editorial-pass-"));
    try {
      mkdirSync(join(dir, ".preflight"), { recursive: true });
      writeFileSync(
        join(dir, ".preflight", "editorial-state.json"),
        JSON.stringify(
          {
            locked: ["control"],
            banned: ["modular"],
            requiredConcepts: ["inbound", "follow-through"],
          },
          null,
          2
        ),
        "utf8"
      );

      const pf = createPreflight({ cwd: dir, policyPack: makePolicy() });
      const results = await pf.validate({
        tool: "final_response",
        params: { text: "We keep control over inbound and follow-through." },
      });
      expect(results.find((r) => r.rule === "editorial-state-file-present")?.status).toBe("pass");
      expect(results.find((r) => r.rule === "editorial-banned-language")?.status).toBe("pass");
      expect(results.find((r) => r.rule === "editorial-required-coverage")?.status).toBe("pass");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("can resolve editorial state from generic projectState config", async () => {
    const dir = mkdtempSync(join(tmpdir(), "preflight-editorial-project-state-"));
    try {
      mkdirSync(join(dir, ".preflight"), { recursive: true });
      writeFileSync(
        join(dir, ".preflight", "project-state.json"),
        JSON.stringify(
          {
            locked: ["control"],
            requiredConcepts: ["inbound"],
          },
          null,
          2
        ),
        "utf8"
      );

      const pf = createPreflight({
        cwd: dir,
        policyPack: {
          enabledRuleSets: ["editorial"],
          responseChecks: { enabled: true },
          projectState: { stateFile: ".preflight/project-state.json" },
          editorialChecks: {
            enabled: true,
            enforceOnResponseTools: true,
            enforceOnWriteTools: true,
          },
        },
      });
      const results = await pf.validate({
        tool: "final_response",
        params: { text: "We keep control over inbound." },
      });
      expect(results.find((r) => r.rule === "editorial-required-coverage")?.status).toBe("pass");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails cleanly when the editorial state file has invalid JSON", async () => {
    const dir = mkdtempSync(join(tmpdir(), "preflight-editorial-invalid-json-"));
    try {
      mkdirSync(join(dir, ".preflight"), { recursive: true });
      writeFileSync(join(dir, ".preflight", "editorial-state.json"), "{bad json", "utf8");

      const pf = createPreflight({ cwd: dir, policyPack: makePolicy() });
      const results = await pf.validate({
        tool: "final_response",
        params: { text: "control inbound" },
      });
      const stateResult = results.find((r) => r.rule === "editorial-state-file-present");
      expect(stateResult?.status).toBe("fail");
      expect(String(stateResult?.message || "")).toContain("invalid JSON");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
