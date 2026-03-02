/**
 * YAML validation rule — catches invalid YAML before it's written to disk.
 *
 * AI agents frequently produce broken YAML — bad indentation, tabs instead
 * of spaces, unclosed quotes, duplicate keys. This rule catches structural
 * errors without pulling in a full YAML parser (zero dependencies).
 *
 * Rules:
 * - yaml-syntax-validation: fails on detectable YAML syntax issues in .yml/.yaml files
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

function isYaml(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith('.yml') || lower.endsWith('.yaml');
}

interface YamlIssue {
  message: string;
  suggestion: string;
}

/**
 * Lightweight YAML lint — catches the most common AI mistakes without
 * requiring a full parser. Returns the first issue found, or null if clean.
 */
function lintYaml(content: string): YamlIssue | null {
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Tabs for indentation (YAML only allows spaces)
    if (/^\t/.test(line)) {
      return {
        message: `Tab indentation on line ${lineNum} — YAML requires spaces`,
        suggestion: 'Replace tabs with spaces for indentation',
      };
    }

    // Unclosed quotes (single or double)
    const stripped = line.replace(/#.*$/, ''); // strip comments
    const singleQuotes = (stripped.match(/'/g) ?? []).length;
    const doubleQuotes = (stripped.match(/"/g) ?? []).length;
    if (singleQuotes % 2 !== 0 && !stripped.includes("''")) {
      return {
        message: `Unclosed single quote on line ${lineNum}`,
        suggestion: 'Close the quote or escape it',
      };
    }
    if (doubleQuotes % 2 !== 0 && !stripped.includes('""')) {
      return {
        message: `Unclosed double quote on line ${lineNum}`,
        suggestion: 'Close the quote or escape it',
      };
    }

    // Duplicate top-level keys (common AI mistake when regenerating YAML)
    if (/^[a-zA-Z_][a-zA-Z0-9_-]*\s*:/.test(line)) {
      const key = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:/)?.[1];
      if (key) {
        for (let j = i + 1; j < lines.length; j++) {
          const laterLine = lines[j];
          if (new RegExp(`^${escapeRegex(key)}\\s*:`).test(laterLine)) {
            return {
              message: `Duplicate top-level key '${key}' on lines ${lineNum} and ${j + 1}`,
              suggestion: `Remove or merge the duplicate '${key}' entry`,
            };
          }
        }
      }
    }
  }

  return null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const yamlSyntaxValidation: Rule = {
  name: 'yaml-syntax-validation',
  matches(call, ctx) {
    if (!ctx.tools.isWrite(call.tool)) return false;
    const path = getPathParam(call);
    if (!path) return false;
    return isYaml(path);
  },
  async validate(call): Promise<ValidationResult> {
    const content = getContent(call);
    if (!content) {
      return { status: 'pass', rule: 'yaml-syntax-validation', message: 'No content to validate' };
    }

    const issue = lintYaml(content);
    if (issue) {
      return {
        status: 'fail',
        rule: 'yaml-syntax-validation',
        message: `Invalid YAML: ${issue.message}`,
        suggestion: issue.suggestion,
      };
    }

    return { status: 'pass', rule: 'yaml-syntax-validation', message: 'YAML looks valid' };
  },
};

export const yamlValidationRules: Rule[] = [yamlSyntaxValidation];
