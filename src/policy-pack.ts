import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PreflightPolicyPack } from "./types.js";

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
    prewriteChecks: { enabled: true, maxBytes: 350000, tsRequireTypeHints: false },
  },
  enterprise: {
    name: "enterprise",
    mode: "enforce",
    enabledRuleSets: ["filesystem", "git", "secrets", "environment", "naming", "parallel", "network", "scope", "release", "session", "prewrite", "time-estimation"],
    destructiveRequireToken: true,
    prewriteChecks: { enabled: true, maxBytes: 250000, tsRequireTypeHints: true },
  },
  speed: {
    name: "speed",
    mode: "warn-only",
    enabledRuleSets: ["filesystem", "git", "secrets", "scope", "release", "time-estimation"],
    destructiveRequireToken: false,
    prewriteChecks: { enabled: false },
  },
};

export async function loadBaselinePolicyTemplate(name: "startup-safe" | "enterprise" | "speed"): Promise<PreflightPolicyPack> {
  const file = join(process.cwd(), "templates", `${name}.preflight.policy.json`);
  try {
    const raw = await readFile(file, "utf8");
    return JSON.parse(raw) as PreflightPolicyPack;
  } catch {
    return baselinePolicies[name];
  }
}
