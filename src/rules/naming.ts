/**
 * Naming rules — enforce file naming conventions.
 *
 * When an AI creates a new file, it should match the naming convention
 * already used in that directory. If every file in src/rules/ is kebab-case,
 * a new file shouldn't suddenly be camelCase. These rules detect the majority
 * convention from sibling files and flag mismatches.
 *
 * Rules:
 * - file-naming-convention: checks new files match the sibling convention
 * - naming-mistakes: catches duplicate extensions (.ts.ts) and spaces in code filenames
 */

import { basename, dirname } from 'node:path';
import { readdirSync, existsSync } from 'node:fs';
import type { Rule, ToolCall, PreflightContext, ValidationResult } from '../types.js';

function getPathParam(call: ToolCall): string | null {
  const p = call.params.path ?? call.params.file_path ?? call.params.file ?? null;
  return typeof p === 'string' ? p : null;
}

type NamingConvention = 'kebab-case' | 'camelCase' | 'PascalCase' | 'snake_case' | 'mixed';

/** Classify a filename into its naming convention by testing regex patterns */
function detectConvention(name: string): NamingConvention {
  const stem = name.replace(/\.[^.]+$/, ''); // strip extension
  if (/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(stem)) return 'kebab-case';
  if (/^[a-z][a-zA-Z0-9]*$/.test(stem)) return 'camelCase';
  if (/^[A-Z][a-zA-Z0-9]*$/.test(stem)) return 'PascalCase';
  if (/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(stem)) return 'snake_case';
  return 'mixed';
}

/**
 * Look at all files in a directory and determine the dominant naming convention.
 * Only returns a result if one convention represents >50% of non-mixed files.
 */
function getMajorityConvention(files: string[]): NamingConvention | null {
  if (files.length === 0) return null;

  const counts: Record<string, number> = {};
  for (const f of files) {
    const conv = detectConvention(f);
    if (conv !== 'mixed') {
      counts[conv] = (counts[conv] ?? 0) + 1;
    }
  }

  let best: string | null = null;
  let bestCount = 0;
  for (const [conv, count] of Object.entries(counts)) {
    if (count > bestCount) {
      best = conv;
      bestCount = count;
    }
  }

  // Only report if majority is clear (>50%)
  if (best && bestCount > files.length * 0.5) {
    return best as NamingConvention;
  }
  return null;
}

/**
 * Check that new files match the naming convention of their sibling files.
 */
const fileNamingConvention: Rule = {
  name: 'file-naming-convention',
  matches(call, ctx) {
    return ctx.tools.isWrite(call.tool) && getPathParam(call) !== null;
  },
  async validate(call) {
    const path = getPathParam(call)!;
    const dir = dirname(path);
    const name = basename(path);

    if (!existsSync(dir)) {
      return { status: 'pass', rule: 'file-naming-convention', message: 'New directory — no convention to match' };
    }

    // Get existing files in the same directory
    let siblings: string[];
    try {
      siblings = readdirSync(dir).filter((f: string) => !f.startsWith('.'));
    } catch {
      return { status: 'pass', rule: 'file-naming-convention', message: 'Could not read directory' };
    }

    if (siblings.length < 3) {
      return { status: 'pass', rule: 'file-naming-convention', message: 'Too few siblings to determine convention' };
    }

    const majorityConv = getMajorityConvention(siblings);
    if (!majorityConv) {
      return { status: 'pass', rule: 'file-naming-convention', message: 'No clear naming convention in directory' };
    }

    const newConv = detectConvention(name);
    if (newConv !== majorityConv && newConv !== 'mixed') {
      return {
        status: 'warn',
        rule: 'file-naming-convention',
        message: `File uses ${newConv} but directory uses ${majorityConv}`,
        suggestion: `Rename to match ${majorityConv} convention`,
      };
    }

    return { status: 'pass', rule: 'file-naming-convention', message: `Matches ${majorityConv} convention` };
  },
};

/**
 * Check for common naming mistakes in file paths.
 */
const namingMistakes: Rule = {
  name: 'naming-mistakes',
  matches(call, ctx) {
    return ctx.tools.isWrite(call.tool) && getPathParam(call) !== null;
  },
  async validate(call) {
    const path = getPathParam(call)!;
    const name = basename(path);

    // Double extensions
    const extMatch = name.match(/(\.[a-z]+)(\.[a-z]+)$/i);
    if (extMatch && extMatch[1] === extMatch[2]) {
      return {
        status: 'warn',
        rule: 'naming-mistakes',
        message: `Duplicate extension: ${name}`,
        suggestion: name.replace(/(\.[a-z]+)\1$/i, '$1'),
      };
    }

    // Spaces in filenames (usually unintentional in code projects)
    if (/\s/.test(name) && !path.includes('Desktop') && !path.includes('Documents')) {
      return {
        status: 'warn',
        rule: 'naming-mistakes',
        message: `Filename contains spaces: "${name}"`,
        suggestion: name.replace(/\s+/g, '-'),
      };
    }

    return { status: 'pass', rule: 'naming-mistakes', message: 'No naming issues' };
  },
};

export const namingRules: Rule[] = [
  fileNamingConvention,
  namingMistakes,
];
