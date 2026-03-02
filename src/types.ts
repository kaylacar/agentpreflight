/**
 * Core type definitions for Preflight.
 *
 * These interfaces define the contract between tool calls (from any AI coding tool),
 * validation rules, and the results they produce. Everything flows through these types.
 */

/**
 * Represents a single tool call from an AI coding assistant.
 * Tool names vary by assistant (e.g., "write_file" vs "Write", "bash" vs "Bash")
 * so rule matching is case-insensitive.
 */
export interface ToolCall {
  tool: string;
  params: Record<string, unknown>;
  /** ID of the agent making this call — used for parallel conflict detection */
  agentId?: string;
}

/**
 * The outcome of running a single validation rule against a tool call.
 * - pass: tool call is safe to proceed
 * - warn: tool call has a potential issue but can proceed with caution
 * - fail: tool call should not proceed — something is wrong
 */
export interface ValidationResult {
  status: 'pass' | 'warn' | 'fail';
  rule: string;
  message: string;
  /** Actionable fix — e.g., corrected path, safer command */
  suggestion?: string;
}

/**
 * A validation rule. Rules are the core unit of Preflight.
 * Each rule has a matcher (does this rule apply to this tool call?)
 * and a validator (what's the verdict?).
 */
export interface Rule {
  name: string;
  /** Return true if this rule should run for the given tool call */
  matches: (call: ToolCall, context: PreflightContext) => boolean;
  /** Run the validation check. Always async because some rules need filesystem/git access */
  validate: (call: ToolCall, context: PreflightContext) => Promise<ValidationResult>;
}

/**
 * Runtime context passed to every rule during validation.
 * Contains platform info, paths, and an injectable exec function
 * so rules can be tested without hitting real shell commands.
 */
export interface PreflightContext {
  platform: NodeJS.Platform;
  cwd: string;
  homeDir: string;
  /** Execute a shell command — injectable for testing */
  exec: (cmd: string, args: string[], cwd?: string) => Promise<string>;
  /** Tracks concurrent tool calls across parallel agents for conflict detection */
  inFlight: InFlightTracker;
  /** Local environment manifest — repo names → absolute paths, named paths */
  manifest?: import('./manifest.js').EnvManifest;
  /** Tool name matcher — classifies tool names into categories (write, read, bash, network) */
  tools: import('./tools.js').ToolMatcher;
}

/**
 * Options for createPreflight().
 * All optional — sensible defaults are used when omitted.
 */
export interface PreflightOptions {
  /** Which rule sets to load. Strings load built-in sets, Rule objects add custom rules */
  rules?: Array<string | Rule>;
  platform?: NodeJS.Platform;
  cwd?: string;
  homeDir?: string;
  /** Override the default shell exec — primarily useful for testing */
  exec?: (cmd: string, args: string[], cwd?: string) => Promise<string>;
  /** Path to the local environment manifest (~/.preflight-env.json by default) */
  manifestPath?: string;
  /** Inline manifest — skips file loading, useful for testing */
  manifest?: import('./manifest.js').EnvManifest;
  /** Custom tool name mappings — extends the built-in defaults */
  toolMappings?: import('./tools.js').ToolMappings;
}

/**
 * The public API returned by createPreflight().
 */
export interface Preflight {
  /** Validate a tool call against all loaded rules. Returns one result per matching rule. */
  validate: (call: ToolCall) => Promise<ValidationResult[]>;
  /** Add a custom rule at runtime */
  addRule: (rule: Rule) => void;
}

/** Built-in rule set names */
export type RuleSet = 'filesystem' | 'git' | 'naming' | 'environment' | 'parallel' | 'network' | 'secrets' | 'scope' | 'json-validation' | 'html-security' | 'yaml-validation';

/**
 * Tracks in-flight tool calls for parallel agent conflict detection.
 * When multiple agents run simultaneously, they can clobber each other's writes
 * or create git race conditions. The tracker catches this.
 */
export interface InFlightTracker {
  /** Mark a tool call as currently executing */
  register: (call: ToolCall) => void;
  /** Mark a tool call as finished */
  unregister: (call: ToolCall) => void;
  /** Find other in-flight calls that target the same resource */
  getConflicts: (call: ToolCall) => ToolCall[];
  /** List all currently in-flight calls */
  getAll: () => ToolCall[];
}
