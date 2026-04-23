import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { ProjectState } from "./types.js";

export const DEFAULT_PROJECT_STATE_FILE = ".preflight/project-state.json";

export function parseProjectState(raw: string, filePath = DEFAULT_PROJECT_STATE_FILE): ProjectState {
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Invalid project state format in ${filePath}`);
  }
  return parsed as ProjectState;
}

export async function loadProjectState(stateFile?: string, cwd = process.cwd()): Promise<ProjectState | null> {
  const filePath = resolve(cwd, stateFile ?? DEFAULT_PROJECT_STATE_FILE);
  if (!existsSync(filePath)) return null;
  const raw = await readFile(filePath, "utf8");
  return parseProjectState(raw, filePath);
}

export async function getProjectState(stateFile?: string, cwd = process.cwd()): Promise<ProjectState | null> {
  return loadProjectState(stateFile, cwd);
}

export function resolveProjectStatePath(stateFile?: string, cwd = process.cwd()): string {
  return resolve(cwd, stateFile ?? DEFAULT_PROJECT_STATE_FILE);
}
