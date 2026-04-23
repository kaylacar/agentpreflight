import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import type { EditorialEntry, EditorialState, Rule, ToolCall, ValidationResult } from "../types.js";
import { DEFAULT_EDITORIAL_STATE_FILE, isEditorialState, parseEditorialState } from "../editorial-state.js";

const DEFAULT_STATE_FILE = DEFAULT_EDITORIAL_STATE_FILE;
const RESPONSE_TOOLS = new Set([
  "final_response",
  "assistant_response",
  "assistant_message",
  "respond",
  "response",
  "final",
  "message",
]);
const WRITE_TOOLS = new Set(["write_file", "write", "edit", "edit_file", "create_file", "notebookedit"]);
const NEGATIVE_PREFIXES = [/^no\s+/i, /^do not\s+/i, /^don't\s+/i, /^never\s+/i, /^avoid\s+/i, /^without\s+/i];
const POSITIVE_PREFIXES = [
  /^must include\s+/i,
  /^must preserve\s+/i,
  /^must mention\s+/i,
  /^must distinguish\s+/i,
  /^must cover\s+/i,
  /^must keep\s+/i,
  /^include\s+/i,
  /^preserve\s+/i,
  /^mention\s+/i,
  /^keep\s+/i,
];
const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "around",
  "be",
  "do",
  "for",
  "from",
  "how",
  "in",
  "into",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "section",
  "the",
  "this",
  "to",
  "use",
  "with",
]);

function isResponseTool(call: ToolCall): boolean {
  const tool = call.tool.toLowerCase();
  return RESPONSE_TOOLS.has(tool) || tool.includes("response") || tool.includes("message");
}

function isWriteTool(call: ToolCall): boolean {
  return WRITE_TOOLS.has(call.tool.toLowerCase());
}

function getText(call: ToolCall): string {
  const candidates = [
    call.params.text,
    call.params.message,
    call.params.content,
    call.params.output,
    call.params.response,
    call.params.final,
    call.params.file_text,
    call.params.new_string,
  ];

  for (const value of candidates) {
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return "";
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function tokenize(text: string): string[] {
  return normalize(text)
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !STOPWORDS.has(token));
}

function editorialEnabledForCall(
  call: ToolCall,
  checks?: { enabled?: boolean; enforceOnResponseTools?: boolean; enforceOnWriteTools?: boolean }
): boolean {
  if (checks?.enabled === false) return false;
  if (isResponseTool(call) && checks?.enforceOnResponseTools === false) return false;
  if (isWriteTool(call) && checks?.enforceOnWriteTools === false) return false;
  return isResponseTool(call) || isWriteTool(call);
}

function responseGatesEnabled(call: ToolCall, context: { policyPack?: { responseChecks?: { enabled?: boolean } } }): boolean {
  if (!isResponseTool(call)) return true;
  return context.policyPack?.responseChecks?.enabled !== false;
}

async function resolveState(context: {
  cwd: string;
  projectState?: Record<string, unknown>;
  projectStateError?: string;
  policyPack?: { editorialChecks?: { stateFile?: string }; projectState?: { stateFile?: string } };
}): Promise<{ path: string; state?: EditorialState; error?: string }> {
  const file =
    context.policyPack?.editorialChecks?.stateFile ||
    context.policyPack?.projectState?.stateFile ||
    DEFAULT_STATE_FILE;
  const statePath = path.resolve(context.cwd, file);
  const projectStatePath = context.policyPack?.projectState?.stateFile
    ? path.resolve(context.cwd, context.policyPack.projectState.stateFile)
    : undefined;

  if (context.projectStateError && projectStatePath && projectStatePath === statePath) {
    return { path: statePath, error: context.projectStateError };
  }

  if (context.projectState && projectStatePath && projectStatePath === statePath) {
    if (!isEditorialState(context.projectState)) {
      return { path: statePath, error: `Project state file has invalid editorial shape: ${statePath}` };
    }
    return { path: statePath, state: context.projectState };
  }

  try {
    await access(statePath, constants.F_OK);
  } catch {
    return { path: statePath };
  }

  try {
    const raw = await readFile(statePath, "utf8");
    return {
      path: statePath,
      state: parseEditorialState(raw, statePath),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : `Failed to load editorial state: ${statePath}`;
    return { path: statePath, error: message };
  }
}

function flattenEntries(entries: EditorialEntry[] | undefined): EditorialEntry[] {
  return Array.isArray(entries) ? entries.filter(Boolean) : [];
}

function entryLabel(entry: EditorialEntry): string {
  return Array.isArray(entry) ? entry.join(" | ") : entry;
}

function stripKnownPrefix(value: string): string {
  let stripped = value.trim();
  for (const pattern of [...NEGATIVE_PREFIXES, ...POSITIVE_PREFIXES]) {
    stripped = stripped.replace(pattern, "");
  }
  return stripped.trim();
}

function entryVariants(entry: EditorialEntry): string[] {
  if (Array.isArray(entry)) return entry.map((value) => normalize(value)).filter(Boolean);
  const raw = normalize(entry);
  const stripped = normalize(stripKnownPrefix(entry));
  return [...new Set([raw, stripped].filter(Boolean))];
}

function entryMatches(text: string, entry: EditorialEntry): boolean {
  const variants = entryVariants(entry);
  if (variants.some((variant) => variant.length > 0 && text.includes(variant))) {
    return true;
  }

  const tokens = variants.flatMap(tokenize);
  if (tokens.length === 0) return false;
  const requiredHits = Math.min(2, tokens.length);
  let hits = 0;
  for (const token of new Set(tokens)) {
    if (text.includes(token)) hits += 1;
    if (hits >= requiredHits) return true;
  }
  return false;
}

function missingEntries(text: string, entries: EditorialEntry[]): EditorialEntry[] {
  return entries.filter((entry) => !entryMatches(text, entry));
}

function matchingEntries(text: string, entries: EditorialEntry[]): EditorialEntry[] {
  return entries.filter((entry) => entryMatches(text, entry));
}

function isNegativeConstraint(entry: EditorialEntry): boolean {
  if (Array.isArray(entry)) return false;
  return NEGATIVE_PREFIXES.some((pattern) => pattern.test(entry.trim()));
}

function proseArtifact(artifact: string | undefined): boolean {
  if (!artifact) return false;
  return /(copy|page|landing|homepage|sales|proposal|about|faq|bio|email|script)/i.test(artifact);
}

function looksOutlineLike(text: string): boolean {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 6) return false;

  const bulletish = lines.filter((line) => /^[-*+]\s+/.test(line) || /^\d+\.\s+/.test(line)).length;
  const shortLabels = lines.filter(
    (line) => !/[.!?]$/.test(line) && line.split(/\s+/).length <= 4 && !/^[-*+]\s+/.test(line) && !/^\d+\.\s+/.test(line)
  ).length;
  const sentenceLike = lines.filter((line) => /[.!?]$/.test(line) || line.split(/\s+/).length >= 10).length;

  return (bulletish >= 4 && bulletish / lines.length >= 0.35) || (shortLabels >= 4 && sentenceLike <= 2);
}

const editorialStateFilePresent: Rule = {
  name: "editorial-state-file-present",
  matches(call) {
    return isResponseTool(call) || isWriteTool(call);
  },
  async validate(call, context): Promise<ValidationResult> {
    const checks = context.policyPack?.editorialChecks;
    if (!editorialEnabledForCall(call, checks) || !responseGatesEnabled(call, context)) {
      return { status: "pass", rule: "editorial-state-file-present", message: "Editorial checks not active for this tool" };
    }

    const { path: statePath, state, error } = await resolveState(context);
    if (error) {
      return {
        status: "fail",
        rule: "editorial-state-file-present",
        message: error,
        suggestion: "Fix the editorial state file JSON/shape or rerun `npm run setup:editorial -- --edit`.",
      };
    }
    if (!state) {
      return {
        status: "fail",
        rule: "editorial-state-file-present",
        message: `Editorial state file not found: ${statePath}`,
        suggestion: "Run `npm run setup:editorial -- --edit` to scaffold the state file and policy.",
      };
    }

    return {
      status: "pass",
      rule: "editorial-state-file-present",
      message: `Editorial state loaded from ${statePath}`,
    };
  },
};

const editorialBannedLanguage: Rule = {
  name: "editorial-banned-language",
  matches(call) {
    return isResponseTool(call) || isWriteTool(call);
  },
  async validate(call, context): Promise<ValidationResult> {
    const checks = context.policyPack?.editorialChecks;
    if (!editorialEnabledForCall(call, checks) || !responseGatesEnabled(call, context)) {
      return { status: "pass", rule: "editorial-banned-language", message: "Editorial checks not active for this tool" };
    }

    const text = normalize(getText(call));
    if (!text) {
      return { status: "pass", rule: "editorial-banned-language", message: "No text payload to validate" };
    }

    const { state, error } = await resolveState(context);
    if (error || !state) {
      return { status: "pass", rule: "editorial-banned-language", message: "Editorial state unavailable" };
    }

    const banned = [
      ...flattenEntries(state.banned),
      ...flattenEntries(checks?.bannedTerms),
    ];
    if (banned.length === 0) {
      return { status: "pass", rule: "editorial-banned-language", message: "No banned editorial terms configured" };
    }

    const matched = matchingEntries(text, banned);
    if (matched.length > 0) {
      return {
        status: "fail",
        rule: "editorial-banned-language",
        message: `Banned editorial language found: ${matched.slice(0, 3).map(entryLabel).join(", ")}`,
        suggestion: "Remove banned words, headings, or patterns from the draft before sending it.",
      };
    }

    return { status: "pass", rule: "editorial-banned-language", message: "No banned editorial language found" };
  },
};

const editorialCoverage: Rule = {
  name: "editorial-required-coverage",
  matches(call) {
    return isResponseTool(call) || isWriteTool(call);
  },
  async validate(call, context): Promise<ValidationResult> {
    const checks = context.policyPack?.editorialChecks;
    if (!editorialEnabledForCall(call, checks) || !responseGatesEnabled(call, context)) {
      return { status: "pass", rule: "editorial-required-coverage", message: "Editorial checks not active for this tool" };
    }

    const text = normalize(getText(call));
    if (!text) {
      return { status: "pass", rule: "editorial-required-coverage", message: "No text payload to validate" };
    }

    const { state, error } = await resolveState(context);
    if (error || !state) {
      return { status: "pass", rule: "editorial-required-coverage", message: "Editorial state unavailable" };
    }

    const locked = flattenEntries(state.locked).filter((entry) => !isNegativeConstraint(entry));
    const requiredConcepts = [
      ...flattenEntries(state.requiredConcepts),
      ...flattenEntries(checks?.requiredConcepts),
    ];
    const missingLocked = missingEntries(text, locked);
    const missingRequired = missingEntries(text, requiredConcepts);

    if (missingLocked.length > 0 || missingRequired.length > 0) {
      const details = [
        missingLocked.length > 0 ? `locked: ${missingLocked.slice(0, 3).map(entryLabel).join(", ")}` : "",
        missingRequired.length > 0 ? `required: ${missingRequired.slice(0, 3).map(entryLabel).join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("; ");

      return {
        status: "fail",
        rule: "editorial-required-coverage",
        message: `Draft is missing required editorial coverage${details ? ` (${details})` : ""}.`,
        suggestion: "Add the missing locked points and required concepts before sending the draft.",
      };
    }

    return {
      status: "pass",
      rule: "editorial-required-coverage",
      message: "Locked editorial points and required concepts are present.",
    };
  },
};

const editorialContradictions: Rule = {
  name: "editorial-contradictions",
  matches(call) {
    return isResponseTool(call) || isWriteTool(call);
  },
  async validate(call, context): Promise<ValidationResult> {
    const checks = context.policyPack?.editorialChecks;
    if (!editorialEnabledForCall(call, checks) || !responseGatesEnabled(call, context)) {
      return { status: "pass", rule: "editorial-contradictions", message: "Editorial checks not active for this tool" };
    }

    const text = normalize(getText(call));
    if (!text) {
      return { status: "pass", rule: "editorial-contradictions", message: "No text payload to validate" };
    }

    const { state, error } = await resolveState(context);
    if (error || !state) {
      return { status: "pass", rule: "editorial-contradictions", message: "Editorial state unavailable" };
    }

    const contradictions = flattenEntries(state.locked)
      .filter((entry) => isNegativeConstraint(entry))
      .filter((entry) => entryMatches(text, stripKnownPrefix(Array.isArray(entry) ? entry.join(" ") : entry)));

    if (contradictions.length > 0) {
      return {
        status: "fail",
        rule: "editorial-contradictions",
        message: `Draft contradicts locked prohibitions: ${contradictions.slice(0, 3).map(entryLabel).join(", ")}`,
        suggestion: "Remove the contradicted section, framing, or term before sending the draft.",
      };
    }

    return {
      status: "pass",
      rule: "editorial-contradictions",
      message: "No contradictions against locked prohibitions found.",
    };
  },
};

const editorialArtifactShape: Rule = {
  name: "editorial-artifact-shape",
  matches(call) {
    return isResponseTool(call) || isWriteTool(call);
  },
  async validate(call, context): Promise<ValidationResult> {
    const checks = context.policyPack?.editorialChecks;
    if (!editorialEnabledForCall(call, checks) || !responseGatesEnabled(call, context)) {
      return { status: "pass", rule: "editorial-artifact-shape", message: "Editorial checks not active for this tool" };
    }

    const rawText = getText(call);
    const text = normalize(rawText);
    if (!text) {
      return { status: "pass", rule: "editorial-artifact-shape", message: "No text payload to validate" };
    }

    const { state, error } = await resolveState(context);
    if (error || !state) {
      return { status: "pass", rule: "editorial-artifact-shape", message: "Editorial state unavailable" };
    }

    if (!proseArtifact(state.artifact)) {
      return { status: "pass", rule: "editorial-artifact-shape", message: "Artifact does not require prose-shape validation" };
    }

    if (looksOutlineLike(rawText)) {
      return {
        status: "fail",
        rule: "editorial-artifact-shape",
        message: `Draft looks like an outline or wireframe instead of ${state.artifact}.`,
        suggestion: "Convert headings and bullet scaffolding into live prose before sending the draft.",
      };
    }

    return {
      status: "pass",
      rule: "editorial-artifact-shape",
      message: "Draft shape matches a prose artifact.",
    };
  },
};

export const editorialRules: Rule[] = [
  editorialStateFilePresent,
  editorialBannedLanguage,
  editorialCoverage,
  editorialContradictions,
  editorialArtifactShape,
];
