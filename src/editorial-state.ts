import { appendFile, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";
import type { EditorialEntry, EditorialState, EditorialStateHistoryEntry, EditorialStateUpdate } from "./types.js";

export const DEFAULT_EDITORIAL_STATE_FILE = ".preflight/editorial-state.json";

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isEditorialEntry(value: unknown): value is EditorialEntry {
  return typeof value === "string" || isStringArray(value);
}

function isEditorialEntryArray(value: unknown): value is EditorialEntry[] {
  return Array.isArray(value) && value.every((entry) => isEditorialEntry(entry));
}

export function isEditorialState(value: unknown): value is EditorialState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  if (obj.artifact !== undefined && typeof obj.artifact !== "string") return false;
  if (obj.locked !== undefined && !isEditorialEntryArray(obj.locked)) return false;
  if (obj.banned !== undefined && !isEditorialEntryArray(obj.banned)) return false;
  if (obj.requiredConcepts !== undefined && !isEditorialEntryArray(obj.requiredConcepts)) return false;
  if (obj.open !== undefined && !isStringArray(obj.open)) return false;
  return true;
}

export function parseEditorialState(raw: string, filePath = DEFAULT_EDITORIAL_STATE_FILE): EditorialState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON";
    throw new Error(`Editorial state file is invalid JSON: ${filePath} (${message})`);
  }

  if (!isEditorialState(parsed)) {
    throw new Error(`Editorial state file has invalid shape: ${filePath}`);
  }

  return parsed;
}

function entryKey(entry: EditorialEntry): string {
  if (Array.isArray(entry)) {
    return `arr:${entry.map((value) => normalizeText(value)).join("|")}`;
  }
  return `str:${normalizeText(entry)}`;
}

function mergeEntries(existing: EditorialEntry[] | undefined, incoming: EditorialEntry[] | undefined): EditorialEntry[] | undefined {
  const base = Array.isArray(existing) ? [...existing] : [];
  const add = Array.isArray(incoming) ? incoming.filter(Boolean) : [];
  if (base.length === 0 && add.length === 0) return existing;
  const seen = new Set(base.map(entryKey));
  for (const entry of add) {
    const key = entryKey(entry);
    if (!seen.has(key)) {
      seen.add(key);
      base.push(entry);
    }
  }
  return base;
}

export function mergeEditorialState(existing: EditorialState, update: EditorialStateUpdate): EditorialState {
  return {
    artifact: update.artifact ?? existing.artifact,
    locked: mergeEntries(existing.locked, update.locked),
    banned: mergeEntries(existing.banned, update.banned),
    requiredConcepts: mergeEntries(existing.requiredConcepts, update.requiredConcepts),
    open: mergeEntries(existing.open, update.open) as string[] | undefined,
  };
}

async function loadDefaultTemplate(): Promise<EditorialState> {
  const templatePath = new URL("../templates/editorial-state.json", import.meta.url);
  const raw = await readFile(templatePath, "utf8");
  return parseEditorialState(raw, templatePath.pathname);
}

function backupPath(filePath: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${filePath}.bak.${stamp}`;
}

export function resolveEditorialStatePath(stateFile = DEFAULT_EDITORIAL_STATE_FILE, cwd = process.cwd()): string {
  return resolve(cwd, stateFile);
}

export function resolveEditorialHistoryPath(
  stateFile = DEFAULT_EDITORIAL_STATE_FILE,
  cwd = process.cwd(),
  historyFile?: string
): string {
  if (historyFile) return resolve(cwd, historyFile);
  const statePath = resolveEditorialStatePath(stateFile, cwd);
  const extension = extname(statePath);
  if (extension === ".json") {
    return resolve(dirname(statePath), `${basename(statePath, extension)}.history.jsonl`);
  }
  return resolve(dirname(statePath), `${basename(statePath)}.history.jsonl`);
}

async function appendHistoryEntry(
  entry: EditorialStateHistoryEntry,
  stateFile = DEFAULT_EDITORIAL_STATE_FILE,
  cwd = process.cwd(),
  historyFile?: string
): Promise<void> {
  const historyPath = resolveEditorialHistoryPath(stateFile, cwd, historyFile);
  await mkdir(dirname(historyPath), { recursive: true });
  await appendFile(historyPath, `${JSON.stringify(entry)}\n`, "utf8");
}

export async function loadEditorialState(stateFile = DEFAULT_EDITORIAL_STATE_FILE, cwd = process.cwd()): Promise<EditorialState | null> {
  const filePath = resolveEditorialStatePath(stateFile, cwd);
  if (!existsSync(filePath)) return null;
  const raw = await readFile(filePath, "utf8");
  return parseEditorialState(raw, filePath);
}

export async function loadEditorialStateHistory(
  stateFile = DEFAULT_EDITORIAL_STATE_FILE,
  cwd = process.cwd(),
  historyFile?: string
): Promise<EditorialStateHistoryEntry[]> {
  const historyPath = resolveEditorialHistoryPath(stateFile, cwd, historyFile);
  if (!existsSync(historyPath)) return [];
  const raw = await readFile(historyPath, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as EditorialStateHistoryEntry);
}

export async function updateEditorialState(
  update: EditorialStateUpdate,
  options: { stateFile?: string; cwd?: string; historyFile?: string; source?: string } = {}
): Promise<{ path: string; status: "created" | "updated" | "unchanged" | "repaired"; backupPath?: string; state: EditorialState }> {
  const cwd = options.cwd ?? process.cwd();
  const stateFile = options.stateFile ?? DEFAULT_EDITORIAL_STATE_FILE;
  const filePath = resolveEditorialStatePath(stateFile, cwd);
  await mkdir(dirname(filePath), { recursive: true });

  let baseState: EditorialState;
  let status: "created" | "updated" | "unchanged" | "repaired" = "unchanged";
  let repairedBackupPath: string | undefined;

  if (!existsSync(filePath)) {
    baseState = await loadDefaultTemplate();
    status = "created";
  } else {
    try {
      baseState = (await loadEditorialState(stateFile, cwd)) ?? (await loadDefaultTemplate());
    } catch {
      repairedBackupPath = backupPath(filePath);
      await copyFile(filePath, repairedBackupPath);
      baseState = await loadDefaultTemplate();
      status = "repaired";
    }
  }

  const merged = mergeEditorialState(baseState, update);
  const before = JSON.stringify(baseState);
  const after = JSON.stringify(merged);
  if (status === "created" || status === "repaired" || before !== after) {
    if (status === "unchanged") status = "updated";
    await writeFile(filePath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
    await appendHistoryEntry(
      {
        timestamp: new Date().toISOString(),
        status,
        statePath: filePath,
        update,
        source: options.source,
        backupPath: repairedBackupPath,
      },
      stateFile,
      cwd,
      options.historyFile
    );
  }

  return {
    path: filePath,
    status,
    backupPath: repairedBackupPath,
    state: merged,
  };
}
