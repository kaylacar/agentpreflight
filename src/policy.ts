import type { PolicyMode, ToolCall, ValidationResult, PreflightPolicyPack } from "./types.js";

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

export function buildPatchedCall(
  call: ToolCall,
  results: ValidationResult[],
  policyPack?: PreflightPolicyPack
): ToolCall | undefined {
  const allowedRules = policyPack?.autoPatchAllowedRules ?? ["force-push-protection", "platform-path-sep", "onedrive-redirect"];
  const patch = results.find((r) => r.patch && allowedRules.includes(r.rule));
  if (!patch || !patch.patch) return undefined;
  return {
    ...call,
    params: patch.patch.params ? { ...call.params, ...patch.patch.params } : call.params,
    ...(patch.patch.command
      ? { params: { ...call.params, command: patch.patch.command, cmd: patch.patch.command } }
      : {}),
  };
}
