/**
 * Git rules — validate git operations before they execute.
 *
 * AI tools make git mistakes constantly: pushing without checking divergence,
 * force-pushing to main, committing with nothing staged, skipping hooks.
 * These rules intercept bash commands containing git operations and validate
 * them against the actual repo state.
 *
 * All git rules only match tool calls where tool is a bash tool and the command
 * contains 'git'. They use the injectable exec function from context to run
 * git commands, making them fully testable with mocked responses.
 *
 * Rules:
 * - force-push-protection: fails on force push to main/master, warns on other branches
 * - push-upstream-check: checks upstream exists and branches aren't diverged
 * - staging-verification: checks something is staged before commit, warns on sensitive files
 * - branch-protection: warns on destructive operations (reset --hard, etc.) on main/master
 * - no-verify-detection: warns when --no-verify skips git hooks
 */

import type { Rule, ToolCall, PreflightContext, ValidationResult } from '../types.js';

function getCommandParam(call: ToolCall): string | null {
  const c = call.params.command ?? call.params.cmd ?? null;
  return typeof c === 'string' ? c : null;
}

function isGitCommand(cmd: string): boolean {
  return /\bgit\b/.test(cmd);
}

/**
 * Detect force push operations and warn.
 */
const forcePushProtection: Rule = {
  name: 'force-push-protection',
  matches(call, ctx) {
    if (!ctx.tools.isBash(call.tool)) return false;
    const cmd = getCommandParam(call);
    return cmd !== null && isGitCommand(cmd) && cmd.includes('push');
  },
  async validate(call) {
    const cmd = getCommandParam(call)!;

    if (/--force\b|-f\b/.test(cmd) && !/--force-with-lease/.test(cmd)) {
      const isMainBranch = /\b(main|master)\b/.test(cmd);
      return {
        status: isMainBranch ? 'fail' : 'warn',
        rule: 'force-push-protection',
        message: isMainBranch
          ? 'Force push to main/master — this is destructive'
          : 'Force push detected — this rewrites remote history',
        suggestion: 'Use --force-with-lease for safer force push',
      };
    }

    return { status: 'pass', rule: 'force-push-protection', message: 'Not a force push' };
  },
};

/**
 * Before push, check that upstream exists and branches aren't diverged.
 */
const pushUpstreamCheck: Rule = {
  name: 'push-upstream-check',
  matches(call, ctx) {
    if (!ctx.tools.isBash(call.tool)) return false;
    const cmd = getCommandParam(call);
    return cmd !== null && isGitCommand(cmd) && /\bpush\b/.test(cmd);
  },
  async validate(call, ctx) {
    const cmd = getCommandParam(call)!;

    // Skip if -u flag is present (setting upstream)
    if (/-u\b|--set-upstream/.test(cmd)) {
      return { status: 'pass', rule: 'push-upstream-check', message: 'Setting upstream — OK' };
    }

    try {
      // Get current branch
      const branch = await ctx.exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], ctx.cwd);

      // Check if upstream exists
      try {
        await ctx.exec('git', ['rev-parse', '--abbrev-ref', `${branch}@{upstream}`], ctx.cwd);
      } catch {
        return {
          status: 'warn',
          rule: 'push-upstream-check',
          message: `No upstream set for branch '${branch}'`,
          suggestion: `Use 'git push -u origin ${branch}' to set upstream`,
        };
      }

      // Check for divergence
      const status = await ctx.exec('git', ['status', '--porcelain', '-b'], ctx.cwd);
      if (status.includes('diverged')) {
        return {
          status: 'fail',
          rule: 'push-upstream-check',
          message: `Branch '${branch}' has diverged from upstream`,
          suggestion: 'Pull and resolve before pushing, or use --force-with-lease',
        };
      }

      if (status.includes('behind')) {
        return {
          status: 'warn',
          rule: 'push-upstream-check',
          message: `Branch '${branch}' is behind upstream`,
          suggestion: 'Pull first to avoid rejection',
        };
      }
    } catch {
      // Not a git repo or git not available — skip
      return { status: 'pass', rule: 'push-upstream-check', message: 'Could not check — skipped' };
    }

    return { status: 'pass', rule: 'push-upstream-check', message: 'Upstream OK, no divergence' };
  },
};

/**
 * Before commit, verify what's actually staged.
 */
const stagingVerification: Rule = {
  name: 'staging-verification',
  matches(call, ctx) {
    if (!ctx.tools.isBash(call.tool)) return false;
    const cmd = getCommandParam(call);
    return cmd !== null && isGitCommand(cmd) && /\bcommit\b/.test(cmd);
  },
  async validate(call, ctx) {
    try {
      const staged = await ctx.exec('git', ['diff', '--cached', '--name-only'], ctx.cwd);

      if (!staged.trim()) {
        return {
          status: 'fail',
          rule: 'staging-verification',
          message: 'Nothing is staged for commit',
          suggestion: 'Use git add to stage files first',
        };
      }

      const files = staged.trim().split('\n');

      // Check for sensitive files in staging
      const sensitivePatterns = ['.env', 'credentials', 'secrets', '.pem', '.key', 'id_rsa'];
      const sensitiveFiles = files.filter((f: string) =>
        sensitivePatterns.some((p) => f.toLowerCase().includes(p))
      );

      if (sensitiveFiles.length > 0) {
        return {
          status: 'warn',
          rule: 'staging-verification',
          message: `Potentially sensitive files staged: ${sensitiveFiles.join(', ')}`,
          suggestion: 'Verify these files should be committed',
        };
      }

      // Check for "git add ." or "git add -A" in the command (broad staging)
      const cmd = getCommandParam(call)!;
      if (/git\s+add\s+(-A|\.)\s*(&&|;)/.test(cmd)) {
        return {
          status: 'warn',
          rule: 'staging-verification',
          message: `Broad staging detected (git add . or -A) — ${files.length} files staged`,
          suggestion: 'Prefer staging specific files by name',
        };
      }
    } catch {
      return { status: 'pass', rule: 'staging-verification', message: 'Could not check — skipped' };
    }

    return { status: 'pass', rule: 'staging-verification', message: 'Staging looks clean' };
  },
};

/**
 * Warn on destructive git operations targeting main/master.
 */
const branchProtection: Rule = {
  name: 'branch-protection',
  matches(call, ctx) {
    if (!ctx.tools.isBash(call.tool)) return false;
    const cmd = getCommandParam(call);
    return cmd !== null && isGitCommand(cmd);
  },
  async validate(call, ctx) {
    const cmd = getCommandParam(call)!;

    const destructivePatterns = [
      /reset\s+--hard/,
      /branch\s+-[dD]/,
      /checkout\s+--\s/,
      /clean\s+-f/,
      /rebase\b/,
    ];

    const isDestructive = destructivePatterns.some((p) => p.test(cmd));
    if (!isDestructive) {
      return { status: 'pass', rule: 'branch-protection', message: 'Not a destructive operation' };
    }

    // Check if we're on main/master
    try {
      const branch = await ctx.exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], ctx.cwd);
      if (branch === 'main' || branch === 'master') {
        return {
          status: 'warn',
          rule: 'branch-protection',
          message: `Destructive operation on ${branch} branch`,
          suggestion: 'Switch to a feature branch first',
        };
      }
    } catch {
      // Not a git repo — skip
    }

    return { status: 'pass', rule: 'branch-protection', message: 'Not on protected branch' };
  },
};

/**
 * Detect --no-verify flag which skips git hooks.
 */
const noVerifyDetection: Rule = {
  name: 'no-verify-detection',
  matches(call, ctx) {
    if (!ctx.tools.isBash(call.tool)) return false;
    const cmd = getCommandParam(call);
    return cmd !== null && isGitCommand(cmd) && cmd.includes('--no-verify');
  },
  async validate() {
    return {
      status: 'warn',
      rule: 'no-verify-detection',
      message: '--no-verify flag skips git hooks',
      suggestion: 'Fix the hook issue instead of bypassing it',
    };
  },
};

export const gitRules: Rule[] = [
  forcePushProtection,
  pushUpstreamCheck,
  stagingVerification,
  branchProtection,
  noVerifyDetection,
];
