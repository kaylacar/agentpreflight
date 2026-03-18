import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { RuleEngine } from "./engine.js";
import { loadManifest } from "./manifest.js";
import { loadPolicyPack, loadPolicyPackSync, baselinePolicies, loadBaselinePolicyTemplate } from "./policy-pack.js";
export { loadManifest, resolveRepo, resolvePath, getEnv } from "./manifest.js";
export type { EnvManifest } from "./manifest.js";
import { environmentRules } from "./rules/environment.js";
import { filesystemRules } from "./rules/filesystem.js";
import { gitRules } from "./rules/git.js";
import { namingRules } from "./rules/naming.js";
import { parallelRules, createInFlightTracker } from "./rules/parallel.js";
import { networkRules } from "./rules/network.js";
import { secretsRules } from "./rules/secrets.js";
import { scopeRules } from "./rules/scope.js";
import { releaseRules } from "./rules/release.js";
import { prewriteRules } from "./rules/prewrite.js";
import { sessionRules } from "./rules/session.js";
import { timeEstimationRules } from "./rules/time-estimation.js";
import { applyPolicyMode, buildPatchedCall } from "./policy.js";
import { adaptToolCall } from "./adapters.js";
import { writeTelemetry } from "./telemetry.js";
export { formatResult, formatResults, hasFailures, hasWarnings, summary, explainBlock } from "./reporter.js";
export { createInFlightTracker } from "./rules/parallel.js";
export { replayToolCallsFromFile } from "./ci.js";
export { recordTimeEstimate, estimateDrift } from "./time-calibration.js";
export { adaptToolCall, type InputSchema } from "./adapters.js";
export { loadPolicyPack, loadPolicyPackSync, baselinePolicies, loadBaselinePolicyTemplate } from "./policy-pack.js";
export {
  runOvernightPlan,
  persistRunState,
  OVERNIGHT_STATE_VERSION,
  resolveInitialOvernightState,
} from "./overnight.js";
export type { OvernightPlan, OvernightChunk, OvernightStep, OvernightRunState, CommandRunResult } from "./overnight.js";
export { createPlatformExecutor, normalizeCommand } from "./command-executor.js";
export type { NormalizedCommand } from "./command-executor.js";
import type {
  Preflight,
  PreflightOptions,
  PreflightContext,
  ToolCall,
  ValidationResult,
  Rule,
  RuleSet,
  InFlightTracker,
  PolicyMode,
  PreflightPolicyPack,
} from "./types.js";

export type {
  ToolCall,
  ValidationResult,
  Rule,
  Preflight,
  PreflightOptions,
  PreflightContext,
  RuleSet,
  InFlightTracker,
  PolicyMode,
  PreflightPolicyPack,
};

const execFileAsync = promisify(execFile);

async function defaultExec(cmd: string, args: string[], cwd?: string): Promise<string> {
  const { stdout } = await execFileAsync(cmd, args, { cwd });
  return stdout.trim();
}

const RULE_SETS: Record<RuleSet, Rule[]> = {
  filesystem: filesystemRules,
  git: gitRules,
  naming: namingRules,
  environment: environmentRules,
  parallel: parallelRules,
  network: networkRules,
  secrets: secretsRules,
  scope: scopeRules,
  release: releaseRules,
  prewrite: prewriteRules,
  session: sessionRules,
  "time-estimation": timeEstimationRules,
};

async function resolvePolicyPack(options: PreflightOptions): Promise<PreflightPolicyPack | undefined> {
  if (options.policyPack) return options.policyPack;
  if (options.policyPackPath) return loadPolicyPack(options.policyPackPath);
  return undefined;
}

export function createPreflight(options: PreflightOptions = {}): Preflight {
  const engine = new RuleEngine();
  const tracker = createInFlightTracker();
  const telemetryPath = options.telemetryPath;
  const context: PreflightContext = {
    platform: options.platform ?? process.platform,
    cwd: options.cwd ?? process.cwd(),
    homeDir: options.homeDir ?? homedir(),
    exec: options.exec ?? defaultExec,
    inFlight: tracker,
    manifest: options.manifest,
    policyMode: options.policyMode ?? "enforce",
    sessionToken: options.sessionToken,
    policyPack: options.policyPack,
  };
  const syncPolicyPack = options.policyPack ?? loadPolicyPackSync(options.policyPackPath);
  if (syncPolicyPack) {
    context.policyPack = syncPolicyPack;
    context.policyMode = syncPolicyPack.mode ?? context.policyMode;
  }

  const manifestReady: Promise<void> = context.manifest
    ? Promise.resolve()
    : loadManifest(options.manifestPath)
        .then((m) => {
          if (m) context.manifest = m;
        })
        .catch(() => {});

  const policyReady: Promise<void> = resolvePolicyPack(options)
    .then((p) => {
      if (!p) return;
      context.policyPack = p;
      context.policyMode = p.mode ?? context.policyMode;
    })
    .catch(() => {});

  const defaultRuleSets: RuleSet[] = [
    "filesystem",
    "git",
    "environment",
    "naming",
    "parallel",
    "network",
    "secrets",
    "scope",
    "release",
    "prewrite",
    "session",
    "time-estimation",
  ];

  const policyEnabledRuleSets = context.policyPack?.enabledRuleSets;
  const configuredRuleSets =
    (options.rules as Array<string | Rule> | undefined) ??
    (policyEnabledRuleSets && policyEnabledRuleSets.length > 0 ? policyEnabledRuleSets : defaultRuleSets);
  for (const rule of configuredRuleSets) {
    if (typeof rule === "string") {
      const builtIn = RULE_SETS[rule as RuleSet];
      if (builtIn) engine.addRules(builtIn);
    } else {
      engine.addRule(rule);
    }
  }

  async function runValidation(call: ToolCall): Promise<ValidationResult[]> {
    await Promise.all([manifestReady, policyReady]);
    const started = Date.now();
    tracker.register(call);
    try {
      const raw = await engine.validate(call, context);
      const transformed = applyPolicyMode(raw, context.policyMode);
      writeTelemetry(
        telemetryPath,
        { ...call, params: { ...call.params, durationMs: Date.now() - started } },
        transformed
      );
      return transformed;
    } finally {
      tracker.unregister(call);
    }
  }

  return {
    async validate(call: ToolCall): Promise<ValidationResult[]> {
      return runValidation(call);
    },
    async validateWithPolicy(call: ToolCall): Promise<ValidationResult[]> {
      return runValidation(call);
    },
    async preflightCommand(call: ToolCall): Promise<{ results: ValidationResult[]; blocked: boolean; patchedCall?: ToolCall }> {
      const results = await runValidation(call);
      const blocked = results.some((r) => r.status === "fail");
      const patchedCall = !blocked ? buildPatchedCall(call, results, context.policyPack) : undefined;
      return { results, blocked, patchedCall };
    },
    addRule(rule: Rule) {
      engine.addRule(rule);
    },
  };
}

export async function validateAdapted(
  input: unknown,
  schema: "raw" | "claude" | "cursor" | "codex",
  options: PreflightOptions = {}
): Promise<ValidationResult[]> {
  const pf = createPreflight(options);
  const call = adaptToolCall(input, schema);
  return pf.validateWithPolicy(call);
}
