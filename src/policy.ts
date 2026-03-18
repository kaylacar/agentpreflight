import type { PolicyMode, ToolCall, ValidationResult } from "./types.js";

export function applyPolicyMode(results: ValidationResult[], mode: PolicyMode): ValidationResult[] {
  if (mode === "enforce") return results;
  return results.map((result) => {
    if (result.status !== "fail") return result;
    return {
      ...result,
      status: "warn",
      message:
        mode === "audit-only"
          ? `${result.message} (audit-only mode: not blocking)`
          : `${result.message} (warn-only mode: not blocking)`,
    };
  });
}

export function buildPatchedCall(call: ToolCall, results: ValidationResult[]): ToolCall | undefined {
  const patch = results.find((r) => r.patch);
  if (!patch || !patch.patch) return undefined;
  return {
    ...call,
    params: patch.patch.params ? { ...call.params, ...patch.patch.params } : call.params,
    ...(patch.patch.command
      ? { params: { ...call.params, command: patch.patch.command, cmd: patch.patch.command } }
      : {}),
  };
}
