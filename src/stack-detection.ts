import { existsSync } from "node:fs";
import { join } from "node:path";
import type { RuleSet } from "./types.js";

export type ProjectStack = "node" | "python" | "go" | "rust";

function has(cwd: string, file: string): boolean {
  return existsSync(join(cwd, file));
}

export function detectProjectStacks(cwd: string): Set<ProjectStack> {
  const stacks = new Set<ProjectStack>();
  if (has(cwd, "package.json") || has(cwd, "pnpm-workspace.yaml") || has(cwd, "yarn.lock")) stacks.add("node");
  if (has(cwd, "pyproject.toml") || has(cwd, "requirements.txt") || has(cwd, "setup.py")) stacks.add("python");
  if (has(cwd, "go.mod")) stacks.add("go");
  if (has(cwd, "Cargo.toml")) stacks.add("rust");
  return stacks;
}

export function autoDetectedRuleSets(cwd: string): RuleSet[] {
  const base: RuleSet[] = ["filesystem", "git", "secrets", "environment", "scope", "release", "session", "time-estimation"];
  const stacks = detectProjectStacks(cwd);
  if (stacks.size === 0) return base;
  const extras = new Set<RuleSet>();
  if (stacks.has("node")) {
    extras.add("naming");
    extras.add("network");
    extras.add("parallel");
    extras.add("prewrite");
  }
  if (stacks.has("python") || stacks.has("go") || stacks.has("rust")) {
    extras.add("naming");
    extras.add("prewrite");
  }
  return [...base, ...extras];
}
