import { describe, expect, it } from "vitest";
import { adaptToolCall, createPreflight } from "../src/index.js";
import { validateAdapted } from "../src/index.js";

describe("policy modes and adapters", () => {
  it("adapts claude schema to tool call", () => {
    const call = adaptToolCall(
      {
        tool_name: "Bash",
        tool_input: { command: "git push --force origin master" },
      },
      "claude"
    );
    expect(call.tool).toBe("Bash");
    expect(call.params.command).toBe("git push --force origin master");
    expect(call.source).toBe("claude");
  });

  it("adapts cursor schema variants", () => {
    const call = adaptToolCall(
      {
        name: "Bash",
        arguments: { cmd: "echo hi" },
      },
      "cursor"
    );
    expect(call.tool).toBe("Bash");
    expect(call.params.command).toBe("echo hi");
    expect(call.source).toBe("cursor");
  });

  it("adapts codex schema variants", () => {
    const call = adaptToolCall(
      {
        recipient_name: "functions.shell_command",
        parameters: { command: "git status" },
      },
      "codex"
    );
    expect(call.tool).toBe("bash");
    expect(call.params.command).toBe("git status");
    expect(call.params.codexTool).toBe("functions.shell_command");
    expect(call.source).toBe("codex");
  });

  it("adapts codex apply_patch payloads to editable paths", () => {
    const call = adaptToolCall(
      {
        recipient_name: "functions.apply_patch",
        parameters: {
          patch: "*** Begin Patch\n*** Update File: src/index.ts\n@@\n-old\n+new\n*** End Patch\n",
        },
      },
      "codex"
    );
    expect(call.tool).toBe("edit");
    expect(call.params.path).toBe("src/index.ts");
    expect(call.params.content).toContain("*** Begin Patch");
  });

  it("adapts openclaw schema variants", () => {
    const call = adaptToolCall(
      {
        tool_name: "bash",
        arguments: { cmd: "git status --short" },
      },
      "openclaw"
    );
    expect(call.tool).toBe("bash");
    expect(call.params.command).toBe("git status --short");
  });

  it("validateAdapted accepts openclaw schema", async () => {
    const results = await validateAdapted(
      {
        tool_name: "bash",
        arguments: { cmd: "git push --force origin main" },
      },
      "openclaw",
      { rules: ["git"] }
    );
    expect(results.some((r) => r.rule === "force-push-protection")).toBe(true);
  });

  it("validateAdapted applies command rules to codex shell commands", async () => {
    const results = await validateAdapted(
      {
        recipient_name: "functions.shell_command",
        parameters: { command: "git push --force origin main" },
      },
      "codex",
      { rules: ["git"] }
    );
    expect(results.some((r) => r.rule === "force-push-protection" && r.status === "fail")).toBe(true);
  });

  it("validateAdapted accepts codex hook payloads", async () => {
    const results = await validateAdapted(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command: "git push --force origin main" },
      },
      "codex",
      { rules: ["git"] }
    );
    expect(results.some((r) => r.rule === "force-push-protection" && r.status === "fail")).toBe(true);
  });

  it("warn-only mode downgrades failures", async () => {
    const pf = createPreflight({ rules: ["release"], policyMode: "warn-only" });
    const results = await pf.validateWithPolicy({
      tool: "final_response",
      params: { text: "done and live" },
    });
    expect(results.some((r) => r.rule === "release-claim-requires-evidence" && r.status === "warn")).toBe(true);
  });

  it("audit-only mode downgrades failures", async () => {
    const pf = createPreflight({ rules: ["release"], policyMode: "audit-only" });
    const results = await pf.validateWithPolicy({
      tool: "final_response",
      params: { text: "done and live" },
    });
    expect(results.some((r) => r.rule === "release-claim-requires-evidence" && r.status === "warn")).toBe(true);
  });

  it("preflightCommand returns safe patch for force push", async () => {
    const pf = createPreflight({ rules: ["git"] });
    const out = await pf.preflightCommand({
      tool: "bash",
      params: { command: "git push --force origin feature-x" },
    });
    expect(out.blocked).toBe(false);
    expect(String(out.patchedCall?.params.command || "")).toContain("--force-with-lease");
  });
});
