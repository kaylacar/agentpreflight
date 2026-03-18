/**
 * Core type definitions for Preflight.
 */

export interface ToolCall {
  tool: string;
  params: Record<string, unknown>;
  agentId?: string;
  source?: "raw" | "claude" | "cursor" | "codex";
}

export interface ValidationResult {
  status: "pass" | "warn" | "fail";
  rule: string;
  message: string;
  suggestion?: string;
  patch?: {
    command?: string;
    params?: Record<string, unknown>;
  };
  nextCommand?: string;
}

export interface Rule {
  name: string;
  matches: (call: ToolCall) => boolean;
  validate: (call: ToolCall, context: PreflightContext) => Promise<ValidationResult>;
}

export type PolicyMode = "enforce" | "audit-only" | "warn-only";

export type RuleSet =
  | "filesystem"
  | "git"
  | "naming"
  | "environment"
  | "parallel"
  | "network"
  | "secrets"
  | "scope"
  | "release"
  | "prewrite"
  | "session"
  | "time-estimation";

export interface PreflightPolicyPack {
  name?: string;
  mode?: PolicyMode;
  enabledRuleSets?: RuleSet[];
  blockedCommands?: string[];
  destructiveRequireToken?: boolean;
  prewriteChecks?: {
    enabled?: boolean;
    maxBytes?: number;
    tsRequireTypeHints?: boolean;
  };
}

export interface PreflightContext {
  platform: NodeJS.Platform;
  cwd: string;
  homeDir: string;
  exec: (cmd: string, args: string[], cwd?: string) => Promise<string>;
  inFlight: InFlightTracker;
  manifest?: import("./manifest.js").EnvManifest;
  policyMode: PolicyMode;
  sessionToken?: string;
  policyPack?: PreflightPolicyPack;
}

export interface PreflightOptions {
  rules?: Array<string | Rule>;
  platform?: NodeJS.Platform;
  cwd?: string;
  homeDir?: string;
  exec?: (cmd: string, args: string[], cwd?: string) => Promise<string>;
  manifestPath?: string;
  manifest?: import("./manifest.js").EnvManifest;
  policyMode?: PolicyMode;
  sessionToken?: string;
  policyPackPath?: string;
  policyPack?: PreflightPolicyPack;
  telemetryPath?: string;
}

export interface Preflight {
  validate: (call: ToolCall) => Promise<ValidationResult[]>;
  validateWithPolicy: (call: ToolCall) => Promise<ValidationResult[]>;
  preflightCommand: (call: ToolCall) => Promise<{
    results: ValidationResult[];
    blocked: boolean;
    patchedCall?: ToolCall;
  }>;
  addRule: (rule: Rule) => void;
}

export interface InFlightTracker {
  register: (call: ToolCall) => void;
  unregister: (call: ToolCall) => void;
  getConflicts: (call: ToolCall) => ToolCall[];
  getAll: () => ToolCall[];
}
