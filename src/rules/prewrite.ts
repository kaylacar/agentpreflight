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

export const prewriteRules: Rule[] = [prewriteSizeGate, prewriteTypeHints];
