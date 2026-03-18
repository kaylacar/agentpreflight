import type { Rule } from "../types.js";

function getContent(call: { params: Record<string, unknown> }): string {
  const value = call.params.content ?? call.params.file_text ?? call.params.new_string ?? "";
  return typeof value === "string" ? value : "";
}

function getPath(call: { params: Record<string, unknown> }): string {
  const value = call.params.path ?? call.params.file_path ?? "";
  return typeof value === "string" ? value : "";
}

const writeTools = new Set(["write_file", "write", "edit", "edit_file", "create_file", "notebookedit"]);
function parseCommand(command: string): { cmd: string; args: string[] } | null {
  const trimmed = command.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/\s+/g);
  if (parts.length === 0) return null;
  return { cmd: parts[0], args: parts.slice(1) };
}

function extension(path: string): string {
  const match = path.toLowerCase().match(/(\.[a-z0-9]+)$/);
  return match ? match[1] : "";
}

const prewriteSizeGate: Rule = {
  name: "prewrite-size-gate",
  matches(call) {
    return writeTools.has(call.tool.toLowerCase());
  },
  async validate(call, context) {
    const content = getContent(call);
    const maxBytes = context.policyPack?.prewriteChecks?.maxBytes ?? 350000;
    if (Buffer.byteLength(content, "utf8") > maxBytes) {
      return {
        status: "fail",
        rule: "prewrite-size-gate",
        message: `Write payload exceeds max bytes (${maxBytes})`,
        suggestion: "Split into smaller writes by file/section",
      };
    }
    return { status: "pass", rule: "prewrite-size-gate", message: "Write size OK" };
  },
};

const prewriteTypeHints: Rule = {
  name: "prewrite-type-hints",
  matches(call) {
    return writeTools.has(call.tool.toLowerCase());
  },
  async validate(call, context) {
    if (!context.policyPack?.prewriteChecks?.tsRequireTypeHints) {
      return { status: "pass", rule: "prewrite-type-hints", message: "Type hint check disabled" };
    }
    const path = getPath(call).toLowerCase();
    const content = getContent(call);
    if (!path.endsWith(".ts") && !path.endsWith(".tsx")) {
      return { status: "pass", rule: "prewrite-type-hints", message: "Not a TypeScript file" };
    }
    if (!content.includes(":") && !content.includes("interface ") && !content.includes("type ")) {
      return {
        status: "warn",
        rule: "prewrite-type-hints",
        message: "TypeScript file appears to have no explicit type hints",
        suggestion: "Add explicit parameter/return types for public functions",
      };
    }
    return { status: "pass", rule: "prewrite-type-hints", message: "Type hints look present" };
  },
};

const prewriteExternalChecks: Rule = {
  name: "prewrite-external-checks",
  matches(call) {
    return writeTools.has(call.tool.toLowerCase());
  },
  async validate(call, context) {
    const checks = context.policyPack?.prewriteChecks;
    if (!checks?.enabled) {
      return { status: "pass", rule: "prewrite-external-checks", message: "External checks disabled" };
    }

    const path = getPath(call);
    const ext = extension(path);
    const allowed = checks.applyToExtensions;
    if (Array.isArray(allowed) && allowed.length > 0 && !allowed.map((x) => x.toLowerCase()).includes(ext)) {
      return { status: "pass", rule: "prewrite-external-checks", message: "Extension not configured for external checks" };
    }

    const commands = [checks.lintCommand, checks.typecheckCommand].filter((c): c is string => typeof c === "string" && c.trim().length > 0);
    if (commands.length === 0) {
      return { status: "pass", rule: "prewrite-external-checks", message: "No external commands configured" };
    }

    for (const command of commands) {
      const parsed = parseCommand(command);
      if (!parsed) continue;
      try {
        await context.exec(parsed.cmd, parsed.args, context.cwd);
      } catch {
        return {
          status: "fail",
          rule: "prewrite-external-checks",
          message: `Pre-write check failed: ${command}`,
          suggestion: `Run "${command}" and fix issues before writing`,
          nextCommand: command,
        };
      }
    }

    return { status: "pass", rule: "prewrite-external-checks", message: "External pre-write checks passed" };
  },
};

export const prewriteRules: Rule[] = [prewriteSizeGate, prewriteTypeHints, prewriteExternalChecks];
