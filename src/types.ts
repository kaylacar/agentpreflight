/**
 * Core type definitions for Preflight.
 */

export interface ToolCall {
  tool: string;
  params: Record<string, unknown>;
  agentId?: string;
  source?: "raw" | "claude" | "cursor" | "codex" | "openclaw";
}

export type EditorialEntry = string | string[];

export interface EditorialState {
  artifact?: string;
  locked?: EditorialEntry[];
  banned?: EditorialEntry[];
  requiredConcepts?: EditorialEntry[];
  open?: string[];
}

export interface EditorialStateUpdate {
  artifact?: string;
  locked?: EditorialEntry[];
  banned?: EditorialEntry[];
  requiredConcepts?: EditorialEntry[];
  open?: string[];
}

export interface EditorialStateHistoryEntry {
  timestamp: string;
  status: "created" | "updated" | "unchanged" | "repaired";
  statePath: string;
  update: EditorialStateUpdate;
  source?: string;
  backupPath?: string;
}

export interface ProjectState {
  [key: string]: unknown;
}

export type EditorialImportSource =
  | "auto"
  | "claude-md"
  | "agents-md"
  | "codex-notes"
  | "copilot-instructions"
  | "openclaw"
  | "markdown";

export interface EditorialImportResult {
  source: EditorialImportSource;
  importPath: string;
  extracted: EditorialStateUpdate;
  status?: "created" | "updated" | "unchanged" | "repaired";
  statePath?: string;
  backupPath?: string;
}

export interface DoctorCheck {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
}

export interface DoctorReport {
  cwd: string;
  status: "pass" | "warn" | "fail";
  checks: DoctorCheck[];
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
  | "editorial"
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
    lintCommand?: string;
    typecheckCommand?: string;
    applyToExtensions?: string[];
  };
  editorialChecks?: {
    enabled?: boolean;
    stateFile?: string;
    enforceOnResponseTools?: boolean;
    enforceOnWriteTools?: boolean;
    bannedTerms?: EditorialEntry[];
    requiredConcepts?: EditorialEntry[];
  };
  responseChecks?: {
    enabled?: boolean;
  };
  projectState?: {
    stateFile?: string;
  };
  autoPatchAllowedRules?: string[];
  requireCalibrationOnEstimates?: boolean;
}

export interface PreflightContext {
  platform: NodeJS.Platform;
  cwd: string;
  homeDir: string;
  exec: (cmd: string, args: string[], cwd?: string) => Promise<string>;
  inFlight: InFlightTracker;
  manifest?: import("./manifest.js").EnvManifest;
  projectState?: ProjectState;
  projectStateError?: string;
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
  projectStatePath?: string;
  projectState?: ProjectState;
  policyMode?: PolicyMode;
  sessionToken?: string;
  policyPackPath?: string;
  policyPack?: PreflightPolicyPack;
  telemetryPath?: string;
  telemetryRequired?: boolean;
  stackAutoDetect?: boolean;
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
