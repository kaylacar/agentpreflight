/**
 * Rule engine — the core of Preflight.
 *
 * Takes a collection of rules and a tool call, finds which rules match,
 * runs them all in parallel, and returns the combined results.
 *
 * The engine itself is stateless — all state lives in the PreflightContext
 * that gets passed through to each rule.
 */

import type { Rule, ToolCall, ValidationResult, PreflightContext } from './types.js';

export class RuleEngine {
  private rules: Rule[] = [];

  addRule(rule: Rule): void {
    this.rules.push(rule);
  }

  addRules(rules: Rule[]): void {
    for (const rule of rules) {
      this.rules.push(rule);
    }
  }

  /**
   * Run all matching rules against a tool call.
   * Rules are matched first (synchronous), then all matching rules
   * are validated in parallel for speed.
   */
  async validate(call: ToolCall, context: PreflightContext): Promise<ValidationResult[]> {
    const matching = this.rules.filter((r) => r.matches(call));
    if (matching.length === 0) return [];

    // Run all matching rules concurrently — they're independent of each other
    const results = await Promise.all(
      matching.map((r) => r.validate(call, context))
    );

    return results;
  }
}
