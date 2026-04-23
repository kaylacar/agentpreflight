import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { loadProjectState, resolveProjectStatePath } from "../src/project-state.js";

describe("project state", () => {
  it("loads a project state file from the default path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "preflight-project-state-"));
    try {
      mkdirSync(join(dir, ".preflight"), { recursive: true });
      writeFileSync(
        join(dir, ".preflight", "project-state.json"),
        JSON.stringify({ artifact: "homepage_copy", locked: ["control"] }, null, 2),
        "utf8"
      );

      const state = await loadProjectState(undefined, dir);
      expect(state).toEqual({ artifact: "homepage_copy", locked: ["control"] });
      expect(resolveProjectStatePath(undefined, dir)).toBe(join(dir, ".preflight", "project-state.json"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
