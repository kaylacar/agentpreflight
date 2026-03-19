import { describe, expect, it } from "vitest";
import { normalizeShellCommand, parseArgs } from "../setup/preflight-exec.mjs";

describe("preflight-exec argument and shell normalization", () => {
  it("parses --cwd and --arg tokens into a deterministic command", () => {
    const parsed = parseArgs([
      "--cwd",
      "C:\\repo",
      "--arg",
      "npm.cmd",
      "--arg",
      "-C",
      "--arg",
      "C:\\repo with spaces",
      "--arg",
      "run",
      "--arg",
      "verify",
    ]);
    expect(parsed.cwd).toBe("C:\\repo");
    expect(parsed.command).toBe("npm.cmd -C C:\\repo with spaces run verify");
  });

  it("normalizes shell on windows with cmd.exe", () => {
    const win = normalizeShellCommand("win32", "echo ok");
    expect(win.file).toBe("cmd.exe");
    expect(win.args).toEqual(["/d", "/s", "/c", "echo ok"]);
  });

  it("normalizes shell on unix with sh -lc", () => {
    const unix = normalizeShellCommand("linux", "echo ok");
    expect(unix.file).toBe("sh");
    expect(unix.args).toEqual(["-lc", "echo ok"]);
  });
});
