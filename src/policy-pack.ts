import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PreflightPolicyPack } from "./types.js";

const moduleDir = fileURLToPath(new URL(".", import.meta.url));

export async function loadPolicyPack(path?: string): Promise<PreflightPolicyPack | undefined> {
  if (!path) return undefined;
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as PreflightPolicyPack;
}

export function loadPolicyPackSync(path?: string): PreflightPolicyPack | undefined {
  if (!path || !existsSync(path)) return undefined;
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as PreflightPolicyPack;
}

export const baselinePolicies: Record<string, PreflightPolicyPack> = {
  "startup-safe": {
    name: "startup-safe",
    mode: "enforce",
    enabledRuleSets: ["filesystem", "git", "secrets", "environment", "scope", "release", "session", "prewrite", "time-estimation"],
    destructiveRequireToken: true,
    autoPatchAllowedRules: ["force-push-protection", "platform-path-sep", "onedrive-redirect"],
    requireCalibrationOnEstimates: true,
    prewriteChecks: { enabled: true, maxBytes: 350000, tsRequireTypeHints: false },
  },
  enterprise: {
    name: "enterprise",
    mode: "enforce",
    enabledRuleSets: ["filesystem", "git", "secrets", "environment", "naming", "parallel", "network", "scope", "release", "session", "prewrite", "time-estimation"],
    destructiveRequireToken: true,
    autoPatchAllowedRules: ["platform-path-sep", "onedrive-redirect"],
    requireCalibrationOnEstimates: true,
    prewriteChecks: { enabled: true, maxBytes: 250000, tsRequireTypeHints: true },
  },
  speed: {
    name: "speed",
    mode: "warn-only",
    enabledRuleSets: ["filesystem", "git", "secrets", "scope", "release", "time-estimation"],
    destructiveRequireToken: false,
    autoPatchAllowedRules: ["force-push-protection", "platform-path-sep", "onedrive-redirect"],
    requireCalibrationOnEstimates: false,
    prewriteChecks: { enabled: false },
  },
  editorial: {
    name: "editorial",
    mode: "enforce",
    enabledRuleSets: ["filesystem", "git", "secrets", "environment", "scope", "release", "editorial"],
    destructiveRequireToken: true,
    autoPatchAllowedRules: ["force-push-protection", "platform-path-sep", "onedrive-redirect"],
    requireCalibrationOnEstimates: false,
    responseChecks: { enabled: true },
    projectState: { stateFile: ".preflight/editorial-state.json" },
    editorialChecks: {
      enabled: true,
      stateFile: ".preflight/editorial-state.json",
      enforceOnResponseTools: true,
      enforceOnWriteTools: true,
    },
  },
};

export async function loadBaselinePolicyTemplate(
  name: "startup-safe" | "enterprise" | "speed" | "editorial"
): Promise<PreflightPolicyPack> {
  const file = join(moduleDir, "..", "templates", `${name}.preflight.policy.json`);
  try {
    const raw = await readFile(file, "utf8");
    return JSON.parse(raw) as PreflightPolicyPack;
  } catch {
    return baselinePolicies[name];
  }
}
