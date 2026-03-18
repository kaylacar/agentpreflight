import { resolve } from 'node:path';
import type { Rule, ToolCall, ValidationResult, PreflightContext } from '../types.js';

const FILE_TOOLS = new Set([
  'write_file', 'write', 'edit', 'edit_file', 'create_file', 'notebookedit',
  'read_file', 'read', 'delete_file', 'move_file',
]);

const SYSTEM_DIRS: RegExp[] = [
  /^\/etc\//,
  /^\/usr\//,
  /^\/bin\//,
  /^\/sbin\//,
  /^\/sys\//,
  /^\/proc\//,
  /^\/boot\//,
  /^[A-Z]:\\Windows\\/i,
  /^[A-Z]:\\Program Files/i,
  /^[A-Z]:\\System32/i,
];

function isSystemDir(p: string): boolean {
  // Normalize to forward slashes for cross-platform matching
  const normalized = p.replace(/\\/g, '/');
  return SYSTEM_DIRS.some(r => r.test(p) || r.test(normalized));
}

function getPathParam(call: ToolCall): string | null {
  const p = call.params.path ?? call.params.file_path ?? call.params.file ?? null;
  return typeof p === 'string' ? p : null;
}

function normalizePathForCompare(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

const pathTraversal: Rule = {
  name: 'scope-path-traversal',
  matches(call) {
    return FILE_TOOLS.has(call.tool.toLowerCase()) && getPathParam(call) !== null;
  },
  async validate(call, context: PreflightContext): Promise<ValidationResult> {
    const raw = getPathParam(call)!;
    const absolute = resolve(context.cwd, raw);
    const normalizedAbsolute = normalizePathForCompare(absolute);
    const normalizedCwd = normalizePathForCompare(context.cwd);

    if (!(normalizedAbsolute === normalizedCwd || normalizedAbsolute.startsWith(`${normalizedCwd}/`))) {
      return {
        status: 'fail',
        rule: 'scope-path-traversal',
        message: `Path escapes working directory: ${raw}`,
        suggestion: `Stay within ${context.cwd}`,
      };
    }

    return { status: 'pass', rule: 'scope-path-traversal', message: 'Path within working directory' };
  },
};

const systemDirWrite: Rule = {
  name: 'scope-system-dir-write',
  matches(call) {
    const writeTools = new Set([
      'write_file', 'write', 'edit', 'edit_file', 'create_file', 'notebookedit',
      'delete_file', 'move_file',
    ]);
    return writeTools.has(call.tool.toLowerCase()) && getPathParam(call) !== null;
  },
  async validate(call, context: PreflightContext): Promise<ValidationResult> {
    const raw = getPathParam(call)!;
    const absolute = resolve(context.cwd, raw);

    if (isSystemDir(raw) || isSystemDir(absolute)) {
      return {
        status: 'fail',
        rule: 'scope-system-dir-write',
        message: `Attempt to write to system directory: ${raw}`,
        suggestion: 'Writing to system directories can break the OS — confirm this is intentional',
      };
    }

    return { status: 'pass', rule: 'scope-system-dir-write', message: 'Not a system directory' };
  },
};

export const scopeRules: Rule[] = [
  pathTraversal,
  systemDirWrite,
];
