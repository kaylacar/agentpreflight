import { describe, expect, it } from "vitest";
import {
  blockOutput,
  buildToolCallFromHookPayload,
  warningOutput,
} from "../setup/codex-pre-tool-hook.mjs";

describe("codex pre-tool hook helpers", () => {
  it("builds an agentpreflight tool call from a Codex PreToolUse payload", () => {
    const call = buildToolCallFromHookPayload({
      hook_event_name: "PreToolUse",
      session_id: "session-1",
      tool_name: "Bash",
      tool_input: { command: "git status --short" },
      tool_use_id: "tool-1",
      turn_id: "turn-1",
    });

    expect(call).toMatchObject({
      tool: "bash",
      source: "codex",
      agentId: "session-1",
      params: {
        command: "git status --short",
        codexHookEvent: "PreToolUse",
        codexToolUseId: "tool-1",
        codexTurnId: "turn-1",
      },
    });
  });

  it("emits the Codex PreToolUse deny shape for blocked commands", () => {
    expect(blockOutput("blocked")).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "blocked",
      },
    });
  });

  it("emits system messages for non-blocking warnings", () => {
    expect(warningOutput("warn")).toEqual({ systemMessage: "warn" });
  });
});
