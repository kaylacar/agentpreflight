/**
 * Reporter — formats validation results for display.
 *
 * Produces human-readable output from ValidationResult arrays.
 * Used for CLI output, logging, or feeding back into AI tool responses.
 */

import type { ValidationResult } from './types.js';

const STATUS_LABELS: Record<ValidationResult['status'], string> = {
  pass: 'PASS',
  warn: 'WARN',
  fail: 'FAIL',
};

/** Format a single result as a one-liner with optional suggestion on the next line */
export function formatResult(result: ValidationResult): string {
  const label = STATUS_LABELS[result.status];
  let line = `[${label}] ${result.rule}: ${result.message}`;
  if (result.suggestion) {
    line += `\n       -> ${result.suggestion}`;
  }
  if (result.nextCommand) {
    line += `\n       next: ${result.nextCommand}`;
  }
  return line;
}

/** Format all results, one per line. Returns a default message if no rules matched. */
export function formatResults(results: ValidationResult[]): string {
  if (results.length === 0) return '[PASS] No rules matched';
  return results.map(formatResult).join('\n');
}

/** Quick check: did any rule return fail? */
export function hasFailures(results: ValidationResult[]): boolean {
  return results.some((r) => r.status === 'fail');
}

/** Quick check: did any rule return warn? */
export function hasWarnings(results: ValidationResult[]): boolean {
  return results.some((r) => r.status === 'warn');
}

/** Count results by status */
export function summary(results: ValidationResult[]): {
  total: number;
  pass: number;
  warn: number;
  fail: number;
} {
  return {
    total: results.length,
    pass: results.filter((r) => r.status === 'pass').length,
    warn: results.filter((r) => r.status === 'warn').length,
    fail: results.filter((r) => r.status === 'fail').length,
  };
}

export function explainBlock(results: ValidationResult[]): string {
  const failures = results.filter((r) => r.status === "fail");
  if (failures.length === 0) return "No blocking rules.";
  const lines = failures.map((r) => {
    const next = r.nextCommand || r.suggestion || "Apply the recommended fix and retry.";
    return `Blocked by ${r.rule}: ${r.message}\nNext command: ${next}`;
  });
  return lines.join("\n\n");
}
