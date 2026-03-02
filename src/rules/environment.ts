/**
 * Environment rules — platform-specific path and command validation.
 *
 * These rules catch mismatches between what the AI thinks the environment is
 * and what it actually is. The most common issue: OneDrive folder redirection
 * on Windows, where Desktop/Documents/etc live under OneDrive but the AI
 * uses the non-redirected path.
 *
 * Rules:
 * - onedrive-redirect: catches C:\Users\x\Desktop when it's really C:\Users\x\OneDrive\Desktop
 * - platform-path-sep: catches wrong slash direction for the OS
 * - home-dir-resolution: expands ~ to actual home directory
 * - devnull-platform: catches NUL (Windows) vs /dev/null (Unix) mismatches
 */

import { accessSync, constants } from 'node:fs';
import type { Rule, ToolCall, PreflightContext, ValidationResult } from '../types.js';

/** Known folder redirections on Windows (OneDrive, etc.) */
const REDIRECTED_FOLDERS = ['Desktop', 'Documents', 'Pictures', 'Music', 'Videos'];

/**
 * Extract the file path from a tool call's params.
 * Different AI tools use different param names (path, file_path, file),
 * so we check all common variants.
 */
function getPathParam(call: ToolCall): string | null {
  const p = call.params.path ?? call.params.file_path ?? call.params.file ?? null;
  return typeof p === 'string' ? p : null;
}

/** Extract the command string from a bash tool call */
function getCommandParam(call: ToolCall): string | null {
  const c = call.params.command ?? call.params.cmd ?? null;
  return typeof c === 'string' ? c : null;
}

/** Tool names that operate on files (case-insensitive matching in rules) */
const FILE_TOOLS = new Set([
  'write_file', 'write', 'read_file', 'read', 'edit', 'edit_file',
  'create_file', 'glob', 'grep',
]);

/**
 * Detects when a path targets a folder that's been redirected to OneDrive.
 * e.g. C:\Users\teche\Desktop is actually C:\Users\teche\OneDrive\Desktop
 */
const onedriveRedirect: Rule = {
  name: 'onedrive-redirect',
  matches(call) {
    if (!FILE_TOOLS.has(call.tool.toLowerCase())) return false;
    return getPathParam(call) !== null;
  },
  async validate(call, ctx) {
    const path = getPathParam(call)!;
    if (ctx.platform !== 'win32') {
      return { status: 'pass', rule: 'onedrive-redirect', message: 'Not Windows — skipped' };
    }

    const normalized = path.replace(/\//g, '\\');
    const home = ctx.homeDir.replace(/\//g, '\\');

    for (const folder of REDIRECTED_FOLDERS) {
      const directPath = `${home}\\${folder}`;
      const onedrivePath = `${home}\\OneDrive\\${folder}`;

      if (normalized.startsWith(directPath) && !normalized.includes('OneDrive')) {
        // Check if OneDrive version exists
        try {
          accessSync(onedrivePath, constants.F_OK);
          const corrected = normalized.replace(directPath, onedrivePath);
          return {
            status: 'warn',
            rule: 'onedrive-redirect',
            message: `${folder} is redirected to OneDrive`,
            suggestion: corrected,
          };
        } catch {
          // OneDrive path doesn't exist, direct path is fine
        }
      }
    }

    return { status: 'pass', rule: 'onedrive-redirect', message: 'Path OK' };
  },
};

/**
 * Detects wrong path separators for the platform.
 */
const platformPathSep: Rule = {
  name: 'platform-path-sep',
  matches(call) {
    return getPathParam(call) !== null;
  },
  async validate(call, ctx) {
    const path = getPathParam(call)!;

    if (ctx.platform === 'win32') {
      // Windows accepts both, but warn on forward slashes in absolute paths
      // that look like they were meant to be Unix paths
      if (path.startsWith('/') && !path.startsWith('//')) {
        return {
          status: 'warn',
          rule: 'platform-path-sep',
          message: 'Unix-style absolute path on Windows',
          suggestion: path.replace(/\//g, '\\'),
        };
      }
    } else {
      // Unix — backslashes are wrong
      if (path.includes('\\')) {
        return {
          status: 'warn',
          rule: 'platform-path-sep',
          message: 'Windows-style path separators on Unix',
          suggestion: path.replace(/\\/g, '/'),
        };
      }
    }

    return { status: 'pass', rule: 'platform-path-sep', message: 'Path separators OK' };
  },
};

/**
 * Resolves ~ to the actual home directory.
 */
const homeDirResolution: Rule = {
  name: 'home-dir-resolution',
  matches(call) {
    const path = getPathParam(call);
    return path !== null && path.startsWith('~');
  },
  async validate(call, ctx) {
    const path = getPathParam(call)!;
    const resolved = path.replace(/^~/, ctx.homeDir);
    return {
      status: 'warn',
      rule: 'home-dir-resolution',
      message: 'Tilde path — resolving to home directory',
      suggestion: resolved,
    };
  },
};

/**
 * Detects /dev/null vs NUL platform mismatch in bash commands.
 */
const devNullPlatform: Rule = {
  name: 'devnull-platform',
  matches(call) {
    if (call.tool.toLowerCase() !== 'bash') return false;
    return getCommandParam(call) !== null;
  },
  async validate(call, ctx) {
    const cmd = getCommandParam(call)!;

    if (ctx.platform === 'win32' && cmd.includes('NUL') && !cmd.includes('/dev/null')) {
      // Windows using NUL — fine for native cmd, but bash shell uses /dev/null
      // The shell context matters, but since Claude Code uses bash on Windows, /dev/null works
    }

    if (ctx.platform !== 'win32' && cmd.includes('NUL')) {
      return {
        status: 'warn',
        rule: 'devnull-platform',
        message: 'NUL is Windows-only — use /dev/null on Unix',
        suggestion: cmd.replace(/\bNUL\b/g, '/dev/null'),
      };
    }

    return { status: 'pass', rule: 'devnull-platform', message: 'Platform null device OK' };
  },
};

/**
 * Detects tool calls that reference a repo by name without a full path,
 * and resolves it using the environment manifest when available.
 *
 * e.g. path: 'machinepolicy.org/index.html' → 'C:/Users/teche/machinepolicy.org/index.html'
 */
const repoPathResolution: Rule = {
  name: 'repo-path-resolution',
  matches(call) {
    return getPathParam(call) !== null;
  },
  async validate(call, ctx) {
    if (!ctx.manifest) {
      return { status: 'pass', rule: 'repo-path-resolution', message: 'No manifest — skipped' };
    }

    const path = getPathParam(call)!;

    // Skip if already absolute
    const isAbsolute = path.startsWith('/') || /^[A-Za-z]:/.test(path);
    if (isAbsolute) {
      return { status: 'pass', rule: 'repo-path-resolution', message: 'Path is absolute' };
    }

    // Check if path starts with a known repo name
    for (const [repoName, repoPath] of Object.entries(ctx.manifest.repos)) {
      if (path === repoName || path.startsWith(`${repoName}/`) || path.startsWith(`${repoName}\\`)) {
        const remainder = path.slice(repoName.length);
        const resolved = `${repoPath}${remainder}`;
        return {
          status: 'warn',
          rule: 'repo-path-resolution',
          message: `Resolved repo '${repoName}' to local path`,
          suggestion: resolved,
        };
      }
    }

    // Check named paths
    if (ctx.manifest.paths) {
      for (const [name, resolvedPath] of Object.entries(ctx.manifest.paths)) {
        if (path === name || path.startsWith(`${name}/`) || path.startsWith(`${name}\\`)) {
          const remainder = path.slice(name.length);
          const resolved = `${resolvedPath}${remainder}`;
          return {
            status: 'warn',
            rule: 'repo-path-resolution',
            message: `Resolved named path '${name}' to local path`,
            suggestion: resolved,
          };
        }
      }
    }

    return { status: 'pass', rule: 'repo-path-resolution', message: 'No manifest match' };
  },
};

export const environmentRules: Rule[] = [
  onedriveRedirect,
  platformPathSep,
  homeDirResolution,
  devNullPlatform,
  repoPathResolution,
];
