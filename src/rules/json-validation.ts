/**
 * JSON validation rule — catches invalid JSON before it's written to disk.
 *
 * When an AI writes to a .json file, this rule runs JSON.parse() on the content
 * and fails if the syntax is invalid. Catches truncated JSON, trailing commas,
 * unquoted keys, and other common AI mistakes.
 *
 * Rules:
 * - json-syntax-validation: fails when content written to .json file is not valid JSON
 */

import type { Rule, ToolCall, PreflightContext, ValidationResult } from '../types.js';

function getPathParam(call: ToolCall): string | null {
  const p = call.params.path ?? call.params.file_path ?? call.params.file ?? null;
  return typeof p === 'string' ? p : null;
}

function getContent(call: ToolCall): string | null {
  const c = call.params.content ?? call.params.new_string ?? call.params.source ?? null;
  return typeof c === 'string' ? c : null;
}

const jsonSyntaxValidation: Rule = {
  name: 'json-syntax-validation',
  matches(call, ctx) {
    if (!ctx.tools.isWrite(call.tool)) return false;
    const path = getPathParam(call);
    if (!path) return false;
    return path.toLowerCase().endsWith('.json');
  },
  async validate(call): Promise<ValidationResult> {
    const content = getContent(call);
    if (!content) {
      return { status: 'pass', rule: 'json-syntax-validation', message: 'No content to validate' };
    }

    try {
      JSON.parse(content);
      return { status: 'pass', rule: 'json-syntax-validation', message: 'Valid JSON' };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid JSON';
      return {
        status: 'fail',
        rule: 'json-syntax-validation',
        message: `Invalid JSON: ${message}`,
        suggestion: 'Fix JSON syntax before writing',
      };
    }
  },
};

export const jsonValidationRules: Rule[] = [jsonSyntaxValidation];
