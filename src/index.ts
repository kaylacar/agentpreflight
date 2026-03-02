/**
 * Preflight — pre-flight validation for AI tool calls.
 *
 * This is the main entry point. createPreflight() builds a validator
 * with the specified rule sets, then validate() checks individual
 * tool calls before they execute.
 *
 * Usage:
 *   const pf = createPreflight({ rules: ['filesystem', 'git'] });
 *   const results = await pf.validate({ tool: 'write_file', params: { path: '...' } });
 *   if (hasFailures(results)) { // don't execute }
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { RuleEngine } from './engine.js';
import { environmentRules } from './rules/environment.js';
import { filesystemRules } from './rules/filesystem.js';
import { gitRules } from './rules/git.js';
import { namingRules } from './rules/naming.js';
import { parallelRules, createInFlightTracker } from './rules/parallel.js';
import { networkRules } from './rules/network.js';
import { secretsRules } from './rules/secrets.js';
import { scopeRules } from './rules/scope.js';
import type {
  Preflight,
  PreflightOptions,
  PreflightContext,
  ToolCall,
  ValidationResult,
  Rule,
  RuleSet,
  InFlightTracker,
} from './types.js';

// Re-export everything consumers need
export type { ToolCall, ValidationResult, Rule, Preflight, PreflightOptions, PreflightContext, RuleSet, InFlightTracker };
export { formatResult, formatResults, hasFailures, hasWarnings, summary } from './reporter.js';
export { createInFlightTracker } from './rules/parallel.js';

const execFileAsync = promisify(execFile);

/** Default exec uses node:child_process. Rules call this to run git commands etc. */
async function defaultExec(cmd: string, args: string[], cwd?: string): Promise<string> {
  const { stdout } = await execFileAsync(cmd, args, { cwd });
  return stdout.trim();
}

/** Map of built-in rule set names to their rule arrays */
const RULE_SETS: Record<RuleSet, Rule[]> = {
  filesystem: filesystemRules,
  git: gitRules,
  naming: namingRules,
  environment: environmentRules,
  parallel: parallelRules,
  network: networkRules,
  secrets: secretsRules,
  scope: scopeRules,
};

/**
 * Create a Preflight validator.
 *
 * Options:
 * - rules: which rule sets to load (default: all). Can mix strings and custom Rule objects.
 * - platform: override process.platform (useful for testing cross-platform rules)
 * - cwd: override process.cwd()
 * - homeDir: override os.homedir()
 * - exec: override shell command execution (useful for mocking git in tests)
 */
export function createPreflight(options: PreflightOptions = {}): Preflight {
  const engine = new RuleEngine();
  const tracker = createInFlightTracker();

  // Build the context that gets passed to every rule
  const context: PreflightContext = {
    platform: options.platform ?? process.platform,
    cwd: options.cwd ?? process.cwd(),
    homeDir: options.homeDir ?? homedir(),
    exec: options.exec ?? defaultExec,
    inFlight: tracker,
  };

  // Load rule sets — strings load built-in sets, objects are custom rules
  const ruleSets = options.rules ?? ['filesystem', 'git', 'environment', 'naming', 'parallel', 'network', 'secrets', 'scope'];
  for (const rule of ruleSets) {
    if (typeof rule === 'string') {
      const builtIn = RULE_SETS[rule as RuleSet];
      if (builtIn) {
        engine.addRules(builtIn);
      }
    } else {
      engine.addRule(rule);
    }
  }

  return {
    async validate(call: ToolCall): Promise<ValidationResult[]> {
      // Register in the tracker so parallel rules can see concurrent calls
      tracker.register(call);
      try {
        return await engine.validate(call, context);
      } finally {
        // Always unregister, even if validation throws
        tracker.unregister(call);
      }
    },
    addRule(rule: Rule) {
      engine.addRule(rule);
    },
  };
}
