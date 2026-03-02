/**
 * Parallel agent rules — detect conflicts between concurrent agents.
 *
 * When multiple AI agents (subagents, background agents, etc.) run at the same
 * time, they can clobber each other. Two agents writing the same file = last
 * write wins, first write is silently lost. Two agents running git add and
 * git commit in parallel = commit captures wrong staging state.
 *
 * The InFlightTracker maintains a live list of currently-executing tool calls.
 * When a new call comes in, these rules check it against what's already running
 * to detect resource conflicts.
 *
 * Rules:
 * - parallel-file-conflict: fails when two agents write to the same file path
 * - parallel-git-conflict: fails on dangerous git operation combinations
 *   (staging + committing, branch switch + anything, etc.)
 */

import type { Rule, ToolCall, PreflightContext, ValidationResult, InFlightTracker } from '../types.js';

function getPathParam(call: ToolCall): string | null {
  const p = call.params.path ?? call.params.file_path ?? call.params.file ?? null;
  return typeof p === 'string' ? p : null;
}

function getCommandParam(call: ToolCall): string | null {
  const c = call.params.command ?? call.params.cmd ?? null;
  return typeof c === 'string' ? c : null;
}

/**
 * Creates an in-flight tracker for detecting parallel agent conflicts.
 */
export function createInFlightTracker(): InFlightTracker {
  const calls: ToolCall[] = [];

  return {
    register(call: ToolCall) {
      calls.push(call);
    },
    unregister(call: ToolCall) {
      const idx = calls.indexOf(call);
      if (idx !== -1) calls.splice(idx, 1);
    },
    getConflicts(call: ToolCall): ToolCall[] {
      const path = getPathParam(call);
      if (!path) return [];

      return calls.filter((c) => {
        if (c === call) return false;
        const otherPath = getPathParam(c);
        return otherPath !== null && normalizePath(otherPath) === normalizePath(path);
      });
    },
    getAll() {
      return [...calls];
    },
  };
}

/** Normalize path for cross-platform comparison (lowercase, forward slashes) */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase();
}

/**
 * Detect when parallel agents target the same file.
 * Two agents writing to the same file = last write wins, first write lost.
 */
const parallelFileConflict: Rule = {
  name: 'parallel-file-conflict',
  matches(call, ctx) {
    return ctx.tools.isWrite(call.tool) && getPathParam(call) !== null;
  },
  async validate(call, ctx) {
    const conflicts = ctx.inFlight.getConflicts(call);

    if (conflicts.length > 0) {
      const agents = conflicts
        .map((c) => c.agentId ?? 'unknown')
        .filter((id, i, arr) => arr.indexOf(id) === i);

      return {
        status: 'fail',
        rule: 'parallel-file-conflict',
        message: `File is being modified by ${conflicts.length} other agent(s): ${agents.join(', ')}`,
        suggestion: 'Serialize writes to this file — last write wins, earlier writes are lost',
      };
    }

    return { status: 'pass', rule: 'parallel-file-conflict', message: 'No parallel write conflicts' };
  },
};

/**
 * Detect when parallel agents run conflicting git operations.
 * e.g., one agent staging files while another commits.
 */
const parallelGitConflict: Rule = {
  name: 'parallel-git-conflict',
  matches(call, ctx) {
    if (!ctx.tools.isBash(call.tool)) return false;
    const cmd = getCommandParam(call);
    return cmd !== null && /\bgit\b/.test(cmd);
  },
  async validate(call, ctx) {
    const cmd = getCommandParam(call)!;
    const allInFlight = ctx.inFlight.getAll().filter((c) => c !== call);

    const otherGitCalls = allInFlight.filter((c) => {
      if (!ctx.tools.isBash(c.tool)) return false;
      const otherCmd = getCommandParam(c);
      return otherCmd !== null && /\bgit\b/.test(otherCmd);
    });

    if (otherGitCalls.length === 0) {
      return { status: 'pass', rule: 'parallel-git-conflict', message: 'No parallel git operations' };
    }

    // Dangerous combinations
    const isStaging = /\bgit\s+(add|reset|rm)\b/.test(cmd);
    const isCommitting = /\bgit\s+commit\b/.test(cmd);
    const isPushing = /\bgit\s+push\b/.test(cmd);
    const isCheckout = /\bgit\s+(checkout|switch)\b/.test(cmd);

    for (const other of otherGitCalls) {
      const otherCmd = getCommandParam(other)!;
      const otherIsStaging = /\bgit\s+(add|reset|rm)\b/.test(otherCmd);
      const otherIsCommitting = /\bgit\s+commit\b/.test(otherCmd);
      const otherIsCheckout = /\bgit\s+(checkout|switch)\b/.test(otherCmd);

      // Staging + committing in parallel = race condition
      if ((isStaging && otherIsCommitting) || (isCommitting && otherIsStaging)) {
        return {
          status: 'fail',
          rule: 'parallel-git-conflict',
          message: 'Staging and committing running in parallel — commit may capture wrong files',
          suggestion: 'Stage first, then commit sequentially',
        };
      }

      // Checkout in parallel with anything = chaos
      if (isCheckout || otherIsCheckout) {
        return {
          status: 'fail',
          rule: 'parallel-git-conflict',
          message: 'Branch switch running in parallel with other git operations',
          suggestion: 'Complete the branch switch before running other git commands',
        };
      }

      // Multiple pushes = harmless but confusing
      if (isPushing && /\bgit\s+push\b/.test(otherCmd)) {
        return {
          status: 'warn',
          rule: 'parallel-git-conflict',
          message: 'Multiple parallel push operations',
          suggestion: 'Only one push is needed',
        };
      }
    }

    return { status: 'pass', rule: 'parallel-git-conflict', message: 'No conflicting git operations' };
  },
};

export const parallelRules: Rule[] = [
  parallelFileConflict,
  parallelGitConflict,
];
