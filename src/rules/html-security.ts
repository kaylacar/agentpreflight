/**
 * HTML/JS security rules — detect dangerous patterns in file content.
 *
 * When an AI writes HTML, JS, or TS files, this rule scans for common
 * XSS vectors and unsafe DOM manipulation patterns. Catches innerHTML
 * assignments, eval() calls, document.write(), and similar.
 *
 * Rules:
 * - html-security: warns/fails when dangerous DOM patterns are detected in content
 */

import type { Rule, ToolCall, PreflightContext, ValidationResult } from '../types.js';

const HTML_JS_EXTENSIONS = ['.html', '.htm', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue', '.svelte'];

function getPathParam(call: ToolCall): string | null {
  const p = call.params.path ?? call.params.file_path ?? call.params.file ?? null;
  return typeof p === 'string' ? p : null;
}

function getContent(call: ToolCall): string | null {
  const c = call.params.content ?? call.params.new_string ?? call.params.source ?? null;
  return typeof c === 'string' ? c : null;
}

function isHtmlOrJs(path: string): boolean {
  const lower = path.toLowerCase();
  return HTML_JS_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

interface SecurityPattern {
  name: string;
  pattern: RegExp;
  severity: 'warn' | 'fail';
  suggestion: string;
}

const SECURITY_PATTERNS: SecurityPattern[] = [
  {
    name: 'eval() call',
    pattern: /\beval\s*\(/,
    severity: 'fail',
    suggestion: 'Avoid eval() — it executes arbitrary code and is a security risk',
  },
  {
    name: 'innerHTML assignment',
    pattern: /\.innerHTML\s*=/,
    severity: 'warn',
    suggestion: 'Use textContent or DOM APIs instead of innerHTML to prevent XSS',
  },
  {
    name: 'document.write() call',
    pattern: /document\.write\s*\(/,
    severity: 'warn',
    suggestion: 'Use DOM APIs instead of document.write()',
  },
  {
    name: 'new Function() constructor',
    pattern: /new\s+Function\s*\(/,
    severity: 'warn',
    suggestion: 'Avoid new Function() — it is equivalent to eval()',
  },
  {
    name: 'outerHTML assignment',
    pattern: /\.outerHTML\s*=/,
    severity: 'warn',
    suggestion: 'Use DOM APIs instead of outerHTML assignment to prevent XSS',
  },
];

const htmlSecurityCheck: Rule = {
  name: 'html-security',
  matches(call, ctx) {
    if (!ctx.tools.isWrite(call.tool)) return false;
    const path = getPathParam(call);
    if (!path) return false;
    if (!isHtmlOrJs(path)) return false;
    return getContent(call) !== null;
  },
  async validate(call): Promise<ValidationResult> {
    const content = getContent(call)!;

    for (const sp of SECURITY_PATTERNS) {
      if (sp.pattern.test(content)) {
        return {
          status: sp.severity,
          rule: 'html-security',
          message: `Detected ${sp.name} in file content`,
          suggestion: sp.suggestion,
        };
      }
    }

    return { status: 'pass', rule: 'html-security', message: 'No HTML/JS security issues detected' };
  },
};

export const htmlSecurityRules: Rule[] = [htmlSecurityCheck];
