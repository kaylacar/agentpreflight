/**
 * Filesystem rules — validate file operations before they execute.
 *
 * AI coding tools constantly write to paths that don't exist, read files that
 * aren't there, or accidentally touch sensitive files. These rules catch those
 * mistakes before the tool call goes through.
 *
 * Rules:
 * - parent-dir-exists: fails if target directory doesn't exist before write
 * - file-exists-for-read: fails if reading a nonexistent file
 * - write-permission: fails if the target directory isn't writable
 * - symlink-resolution: warns if a path is actually a symlink to somewhere else
 * - sensitive-file-write: warns when writing to .env, credentials, keys, etc.
 */

import { accessSync, constants, existsSync, statSync, realpathSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import type { Rule, ToolCall, PreflightContext, ValidationResult } from '../types.js';

function getPathParam(call: ToolCall): string | null {
  const p = call.params.path ?? call.params.file_path ?? call.params.file ?? null;
  return typeof p === 'string' ? p : null;
}

const WRITE_TOOLS = new Set([
  'write_file', 'write', 'edit', 'edit_file', 'create_file', 'notebookedit',
]);

const READ_TOOLS = new Set([
  'read_file', 'read',
]);

/**
 * Before writing a file, check that the parent directory exists.
 */
const parentDirExists: Rule = {
  name: 'parent-dir-exists',
  matches(call) {
    return WRITE_TOOLS.has(call.tool.toLowerCase()) && getPathParam(call) !== null;
  },
  async validate(call) {
    const path = getPathParam(call)!;
    const parent = dirname(path);

    if (!existsSync(parent)) {
      return {
        status: 'fail',
        rule: 'parent-dir-exists',
        message: `Parent directory does not exist: ${parent}`,
        suggestion: `Create it first, or check the path`,
      };
    }

    return { status: 'pass', rule: 'parent-dir-exists', message: 'Parent directory exists' };
  },
};

/**
 * Before reading a file, check that it exists.
 */
const fileExistsForRead: Rule = {
  name: 'file-exists-for-read',
  matches(call) {
    return READ_TOOLS.has(call.tool.toLowerCase()) && getPathParam(call) !== null;
  },
  async validate(call) {
    const path = getPathParam(call)!;

    if (!existsSync(path)) {
      return {
        status: 'fail',
        rule: 'file-exists-for-read',
        message: `File does not exist: ${path}`,
      };
    }

    return { status: 'pass', rule: 'file-exists-for-read', message: 'File exists' };
  },
};

/**
 * Check write permissions on the target directory.
 */
const writePermission: Rule = {
  name: 'write-permission',
  matches(call) {
    return WRITE_TOOLS.has(call.tool.toLowerCase()) && getPathParam(call) !== null;
  },
  async validate(call) {
    const path = getPathParam(call)!;
    const dir = existsSync(path) ? (statSync(path).isDirectory() ? path : dirname(path)) : dirname(path);

    if (!existsSync(dir)) {
      // parent-dir-exists rule handles this
      return { status: 'pass', rule: 'write-permission', message: 'Deferred to parent-dir-exists' };
    }

    try {
      accessSync(dir, constants.W_OK);
      return { status: 'pass', rule: 'write-permission', message: 'Write permission OK' };
    } catch {
      return {
        status: 'fail',
        rule: 'write-permission',
        message: `No write permission on: ${dir}`,
      };
    }
  },
};

/**
 * Resolve symlinks and warn if the real path differs from the given path.
 */
const symlinkResolution: Rule = {
  name: 'symlink-resolution',
  matches(call) {
    const path = getPathParam(call);
    return path !== null && existsSync(path);
  },
  async validate(call) {
    const path = getPathParam(call)!;

    try {
      const real = realpathSync(path);
      const normalizedPath = resolve(path);
      const normalizedReal = resolve(real);

      if (normalizedPath !== normalizedReal) {
        return {
          status: 'warn',
          rule: 'symlink-resolution',
          message: `Path is a symlink`,
          suggestion: `Real path: ${normalizedReal}`,
        };
      }
    } catch {
      // Can't resolve — skip
    }

    return { status: 'pass', rule: 'symlink-resolution', message: 'Path is direct' };
  },
};

/**
 * Detect writing to sensitive files (.env, credentials, etc.)
 */
const sensitiveFileWrite: Rule = {
  name: 'sensitive-file-write',
  matches(call) {
    return WRITE_TOOLS.has(call.tool.toLowerCase()) && getPathParam(call) !== null;
  },
  async validate(call) {
    const path = getPathParam(call)!;
    const name = basename(path).toLowerCase();

    const sensitivePatterns = [
      '.env', '.env.local', '.env.production',
      'credentials.json', 'secrets.json', 'secrets.yaml', 'secrets.yml',
      'id_rsa', 'id_ed25519', '.pem', '.key',
    ];

    for (const pattern of sensitivePatterns) {
      if (name === pattern || name.endsWith(pattern)) {
        return {
          status: 'warn',
          rule: 'sensitive-file-write',
          message: `Writing to potentially sensitive file: ${name}`,
          suggestion: 'Verify this is intentional and won\'t expose secrets',
        };
      }
    }

    return { status: 'pass', rule: 'sensitive-file-write', message: 'Not a sensitive file' };
  },
};

export const filesystemRules: Rule[] = [
  parentDirExists,
  fileExistsForRead,
  writePermission,
  symlinkResolution,
  sensitiveFileWrite,
];
