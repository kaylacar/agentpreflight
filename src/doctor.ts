import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEditorialState } from "./editorial-state.js";
import { loadPolicyPack } from "./policy-pack.js";
import { loadProjectState } from "./project-state.js";
import type { DoctorCheck, DoctorReport, PreflightPolicyPack } from "./types.js";

export interface DoctorOptions {
  cwd?: string;
  homeDir?: string;
  policyPackPath?: string;
  policyPack?: PreflightPolicyPack;
  stateFile?: string;
  agents?: Array<"claude" | "openclaw" | "codex">;
}

function makeCheck(name: string, status: DoctorCheck["status"], message: string): DoctorCheck {
  return { name, status, message };
}

function packageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

function hasClaudeHook(settingsPath: string, hookScriptPath: string): boolean {
  if (!existsSync(settingsPath) || !existsSync(hookScriptPath)) return false;
  try {
    const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
    const preToolUse = (settings.hooks as { PreToolUse?: Array<Record<string, unknown>> } | undefined)?.PreToolUse;
    if (!Array.isArray(preToolUse)) return false;
    return preToolUse.some((entry) => {
      if (!entry || typeof entry !== "object") return false;
      const hooks = Array.isArray(entry.hooks) ? entry.hooks : [];
      return hooks.some((hook) => hook && typeof hook === "object" && hook.command === `node ${hookScriptPath.replace(/\\/g, "/")}`);
    });
  } catch {
    return false;
  }
}

function hasOpenClawHook(configPath: string, hookDir: string): boolean {
  if (!existsSync(configPath) || !existsSync(hookDir)) return false;
  try {
    const config = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    const internal = (config.hooks as { internal?: Record<string, unknown> } | undefined)?.internal;
    const load = (internal?.load as { extraDirs?: string[] } | undefined)?.extraDirs;
    if (!Array.isArray(load)) return false;
    return load.includes(resolve(hookDir, ".."));
  } catch {
    return false;
  }
}

export async function runDoctor(options: DoctorOptions = {}): Promise<DoctorReport> {
  const cwd = options.cwd ?? process.cwd();
  const homeDir = options.homeDir ?? homedir();
  const checks: DoctorCheck[] = [];
  const pkgRoot = packageRoot();
  const agents = options.agents ?? ["claude", "openclaw", "codex"];

  const distPath = join(pkgRoot, "dist", "index.js");
  checks.push(
    existsSync(distPath)
      ? makeCheck("package-dist", "pass", `Found SDK bundle: ${distPath}`)
      : makeCheck("package-dist", "fail", `Missing SDK bundle: ${distPath}`)
  );

  const requiredAssets = [
    join(pkgRoot, "templates", "editorial-state.json"),
    join(pkgRoot, "templates", "editorial.preflight.policy.json"),
    join(pkgRoot, "setup", "editorial-setup.mjs"),
  ];
  const missingAssets = requiredAssets.filter((asset) => !existsSync(asset));
  checks.push(
    missingAssets.length === 0
      ? makeCheck("package-assets", "pass", "Required setup and template assets are present.")
      : makeCheck("package-assets", "fail", `Missing package assets: ${missingAssets.join(", ")}`)
  );

  let policyPack = options.policyPack;
  const policyPackPath = options.policyPackPath
    ? resolve(cwd, options.policyPackPath)
    : resolve(cwd, ".preflight", "editorial.preflight.policy.json");
  if (!policyPack && existsSync(policyPackPath)) {
    try {
      policyPack = await loadPolicyPack(policyPackPath);
      checks.push(makeCheck("policy-pack", "pass", `Loaded policy pack: ${policyPackPath}`));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load policy pack";
      checks.push(makeCheck("policy-pack", "fail", `${message}: ${policyPackPath}`));
    }
  } else if (policyPack) {
    checks.push(makeCheck("policy-pack", "pass", "Loaded policy pack from in-memory options."));
  } else {
    checks.push(makeCheck("policy-pack", "warn", `No project policy found at ${policyPackPath}`));
  }

  const stateFile =
    options.stateFile ??
    policyPack?.editorialChecks?.stateFile ??
    policyPack?.projectState?.stateFile ??
    (existsSync(resolve(cwd, ".preflight", "editorial-state.json"))
      ? ".preflight/editorial-state.json"
      : existsSync(resolve(cwd, ".preflight", "project-state.json"))
        ? ".preflight/project-state.json"
        : undefined);

  if (stateFile) {
    const absoluteStatePath = resolve(cwd, stateFile);
    try {
      if (absoluteStatePath.endsWith("editorial-state.json") || policyPack?.editorialChecks?.enabled) {
        await loadEditorialState(stateFile, cwd);
      } else {
        await loadProjectState(stateFile, cwd);
      }
      checks.push(makeCheck("project-state", "pass", `State file resolved: ${absoluteStatePath}`));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load state file";
      checks.push(makeCheck("project-state", "fail", `${message}: ${absoluteStatePath}`));
    }
  } else {
    checks.push(makeCheck("project-state", "warn", "No project/editorial state file found."));
  }

  if (policyPack?.responseChecks?.enabled === false) {
    checks.push(makeCheck("response-gates", "warn", "Response/output gates are explicitly disabled."));
  } else {
    checks.push(makeCheck("response-gates", "pass", "Response/output gates are enabled or unspecified."));
  }

  if (agents.includes("claude")) {
    const settingsPath = join(homeDir, ".claude", "settings.json");
    const hookScriptPath = join(homeDir, ".claude", "hooks", "preflight.mjs");
    checks.push(
      hasClaudeHook(settingsPath, hookScriptPath)
        ? makeCheck("claude-hook", "pass", `Claude hook installed: ${hookScriptPath}`)
        : makeCheck("claude-hook", "warn", `Claude hook not installed or incomplete: ${settingsPath}`)
    );
  }

  if (agents.includes("openclaw")) {
    const configPath = join(homeDir, ".openclaw", "openclaw.json");
    const hookDir = join(cwd, "setup", "openclaw-hooks", "agentpreflight");
    checks.push(
      hasOpenClawHook(configPath, hookDir)
        ? makeCheck("openclaw-hook", "pass", `OpenClaw hook installed: ${configPath}`)
        : makeCheck("openclaw-hook", "warn", `OpenClaw hook not installed or incomplete: ${configPath}`)
    );
  }

  if (agents.includes("codex")) {
    const codexSkill = join(homeDir, ".codex", "skills", "agentpreflight", "SKILL.md");
    checks.push(
      existsSync(codexSkill)
        ? makeCheck("codex-skill", "pass", `Codex skill installed: ${codexSkill}`)
        : makeCheck("codex-skill", "warn", `Codex skill not installed: ${codexSkill}`)
    );
  }

  const status = checks.some((check) => check.status === "fail")
    ? "fail"
    : checks.some((check) => check.status === "warn")
      ? "warn"
      : "pass";

  return {
    cwd,
    status,
    checks,
  };
}
