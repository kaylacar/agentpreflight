import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { loadEditorialState, updateEditorialState } from "../src/index.js";

describe("editorial state sdk", () => {
  it("creates and updates editorial state through sdk helpers", async () => {
    const dir = mkdtempSync(join(tmpdir(), "preflight-editorial-sdk-"));
    try {
      const created = await updateEditorialState(
        {
          artifact: "homepage_copy",
          locked: ["no ecosystem section"],
          banned: ["How It Works"],
          requiredConcepts: ["control"],
          open: ["cta wording"],
        },
        { cwd: dir }
      );

      expect(created.status).toBe("created");
      const loaded = await loadEditorialState(undefined, dir);
      expect(loaded?.artifact).toBe("homepage_copy");
      expect(loaded?.locked).toContain("no ecosystem section");

      const updated = await updateEditorialState(
        {
          locked: ["no ecosystem section", "no x/y contrast"],
          banned: ["How It Works"],
        },
        { cwd: dir }
      );

      expect(updated.status).toBe("updated");
      const raw = JSON.parse(readFileSync(join(dir, ".preflight", "editorial-state.json"), "utf8"));
      expect(raw.locked).toEqual(expect.arrayContaining(["no ecosystem section", "no x/y contrast"]));
      expect(raw.banned.filter((item: string) => item === "How It Works")).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
