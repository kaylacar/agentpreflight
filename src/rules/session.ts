import type { Rule } from "../types.js";

function getCommand(call: { params: Record<string, unknown> }): string {
  const c = call.params.command ?? call.params.cmd ?? "";
  return typeof c === "string" ? c : "";
}

const destructivePatterns = [
  /\brm\s+-rf\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-fd\b/i,
  /\bdel\s+\/f\b/i,
  /\bformat\s+[a-z]:/i,
];

const destructiveSessionCheckpoint: Rule = {
  name: "session-destructive-checkpoint",
  matches(call) {
    if (call.tool.toLowerCase() !== "bash") return false;
    const cmd = getCommand(call);
    return destructivePatterns.some((p) => p.test(cmd));
  },
  async validate(call, context) {
    if (context.policyPack?.destructiveRequireToken === false) {
      return { status: "warn", rule: "session-destructive-checkpoint", message: "Destructive command detected but token gate disabled" };
    }
    if (!context.sessionToken) {
      return {
        status: "fail",
        rule: "session-destructive-checkpoint",
        message: "Destructive command requires session confirmation token",
        suggestion: "Set sessionToken in createPreflight({ sessionToken: '...'} )",
      };
    }
    return { status: "pass", rule: "session-destructive-checkpoint", message: "Session token present for destructive command" };
  },
};

export const sessionRules: Rule[] = [destructiveSessionCheckpoint];
