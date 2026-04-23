import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");

describe("package surface", () => {
  it("ships setup and template assets required by the published package", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    expect(pkg.files).toEqual(expect.arrayContaining(["dist", "setup", "templates"]));
    expect(pkg.bin["agentpreflight-setup-editorial"]).toBe("./setup/editorial-setup.mjs");
    expect(pkg.bin["agentpreflight-setup-hooks"]).toBe("./setup/hooks-setup.mjs");
    expect(pkg.bin["agentpreflight-codex"]).toBe("./setup/codex-preflight.mjs");
    expect(pkg.bin["agentpreflight-codex-hook"]).toBe("./setup/codex-pre-tool-hook.mjs");
    expect(pkg.bin["agentpreflight-exec"]).toBe("./setup/preflight-exec.mjs");
    expect(pkg.bin["agentpreflight-state"]).toBe("./setup/state.mjs");
    expect(pkg.bin["agentpreflight-import"]).toBe("./setup/import-state.mjs");
  });
});
