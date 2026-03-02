/**
 * Local environment manifest — declares where repos and named paths live on this machine.
 *
 * Solves the "where is repo X?" problem. Instead of an agent asking the user
 * for a local path, it calls getEnv() at session start and gets the full map.
 *
 * Manifest file: ~/.preflight-env.json
 *
 * Format:
 *   {
 *     "repos": { "repo-name": "/absolute/local/path", ... },
 *     "paths": { "desktop": "/absolute/path", ... }
 *   }
 *
 * Usage:
 *   const env = await getEnv();
 *   const path = resolveRepo(env, 'machinepolicy.org');
 *   // → 'C:/Users/teche/machinepolicy.org'
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const MANIFEST_FILENAME = '.preflight-env.json';

/**
 * Declares the local machine environment for agent consumption.
 * All paths should be absolute.
 */
export interface EnvManifest {
  /** Map of repo name → absolute local path */
  repos: Record<string, string>;
  /** Named paths (desktop, github root, etc.) */
  paths?: Record<string, string>;
}

/**
 * Load the environment manifest from disk.
 * Returns null if the file doesn't exist — not an error, just not configured.
 *
 * @param manifestPath - Override the default (~/.preflight-env.json)
 */
export async function loadManifest(manifestPath?: string): Promise<EnvManifest | null> {
  const filePath = manifestPath ?? join(homedir(), MANIFEST_FILENAME);
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!isValidManifest(parsed)) {
      throw new Error(`Invalid manifest format in ${filePath}`);
    }
    return parsed;
  } catch (err) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      return null; // File doesn't exist — not configured
    }
    throw err;
  }
}

/**
 * Resolve a repo name to its local absolute path.
 * Returns null if the repo is not declared in the manifest.
 */
export function resolveRepo(manifest: EnvManifest, name: string): string | null {
  return manifest.repos[name] ?? null;
}

/**
 * Resolve a named path (e.g. 'desktop', 'github') to its absolute path.
 * Returns null if not declared.
 */
export function resolvePath(manifest: EnvManifest, name: string): string | null {
  return manifest.paths?.[name] ?? null;
}

/**
 * Load the manifest and return the full environment map.
 * Primary entry point for agents at session start.
 *
 * Returns null if no manifest file exists.
 *
 * Example at session start:
 *   const env = await getEnv();
 *   // env.repos → { 'machinepolicy.org': 'C:/Users/teche/machinepolicy.org', ... }
 */
export async function getEnv(manifestPath?: string): Promise<EnvManifest | null> {
  return loadManifest(manifestPath);
}

function isValidManifest(val: unknown): val is EnvManifest {
  if (typeof val !== 'object' || val === null) return false;
  const obj = val as Record<string, unknown>;
  if (typeof obj.repos !== 'object' || obj.repos === null) return false;
  const repos = obj.repos as Record<string, unknown>;
  for (const [k, v] of Object.entries(repos)) {
    if (typeof k !== 'string' || typeof v !== 'string') return false;
  }
  if (obj.paths !== undefined) {
    if (typeof obj.paths !== 'object' || obj.paths === null) return false;
    const paths = obj.paths as Record<string, unknown>;
    for (const [k, v] of Object.entries(paths)) {
      if (typeof k !== 'string' || typeof v !== 'string') return false;
    }
  }
  return true;
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
