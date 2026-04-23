import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { updateEditorialState } from "./editorial-state.js";
import type { EditorialImportResult, EditorialImportSource, EditorialStateUpdate } from "./types.js";

const SOURCE_CANDIDATES: Record<Exclude<EditorialImportSource, "markdown" | "auto">, string[]> = {
  "claude-md": ["CLAUDE.md"],
  "agents-md": ["AGENTS.md"],
  "codex-notes": ["AGENTS.md", ".codex/notes.md"],
  "copilot-instructions": [".github/copilot-instructions.md"],
  openclaw: [".openclaw/NOTES.md", ".openclaw/README.md", ".openclaw/AGENTS.md"],
};

const SECTION_BUCKETS: Array<{ pattern: RegExp; bucket: keyof EditorialStateUpdate }> = [
  { pattern: /^(locked|approved|keep|must keep|must preserve|must include)\b/i, bucket: "locked" },
  { pattern: /^(banned|avoid|forbidden|rejected|do not use)\b/i, bucket: "banned" },
  { pattern: /^(required|required concepts|must mention|must include)\b/i, bucket: "requiredConcepts" },
  { pattern: /^(open|todo|unresolved|still open)\b/i, bucket: "open" },
];

function ensureBucket(update: EditorialStateUpdate, bucket: keyof EditorialStateUpdate): string[] {
  const existing = update[bucket];
  if (Array.isArray(existing)) return existing as string[];
  const next: string[] = [];
  update[bucket] = next as never;
  return next;
}

function pushUnique(values: string[], entry: string): void {
  const normalized = entry.trim();
  if (!normalized) return;
  if (!values.some((value) => value.trim().toLowerCase() === normalized.toLowerCase())) {
    values.push(normalized);
  }
}

function extractInlineCodeItems(text: string): string[] {
  return [...text.matchAll(/`([^`]+)`/g)].map((match) => match[1].trim()).filter(Boolean);
}

function cleanLine(line: string): string {
  return line
    .replace(/^[-*+]\s+/, "")
    .replace(/^\d+\.\s+/, "")
    .replace(/^>\s?/, "")
    .trim();
}

function isBulletLine(line: string): boolean {
  return /^[-*+]\s+/.test(line) || /^\d+\.\s+/.test(line);
}

function headingBucket(line: string): keyof EditorialStateUpdate | undefined {
  const heading = line.replace(/^#+\s*/, "").replace(/:$/, "").trim();
  for (const entry of SECTION_BUCKETS) {
    if (entry.pattern.test(heading)) return entry.bucket;
  }
  return undefined;
}

function maybeBucketLine(line: string, update: EditorialStateUpdate): void {
  const text = cleanLine(line);
  if (!text) return;

  if (/^(do not|don't|never|avoid)\b/i.test(text)) {
    const banned = ensureBucket(update, "banned");
    const codes = extractInlineCodeItems(text);
    if (codes.length > 0) {
      for (const code of codes) pushUnique(banned, code);
    } else {
      pushUnique(banned, text);
    }
    return;
  }

  if (/^(must|always|required|need to|keep|preserve)\b/i.test(text)) {
    pushUnique(ensureBucket(update, "locked"), text);
    return;
  }

  if (/^(open|todo|unresolved)\b[:\-]/i.test(text)) {
    pushUnique(ensureBucket(update, "open"), text.replace(/^(open|todo|unresolved)\b[:\-]?\s*/i, ""));
  }
}

export function parseMarkdownEditorialState(raw: string): EditorialStateUpdate {
  const update: EditorialStateUpdate = {};
  const lines = raw.split(/\r?\n/);
  let activeBucket: keyof EditorialStateUpdate | undefined;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (/^#{1,6}\s+/.test(line)) {
      activeBucket = headingBucket(line);
      continue;
    }

    if (activeBucket && (isBulletLine(line) || /^`[^`]+`/.test(line))) {
      const values = ensureBucket(update, activeBucket);
      const text = cleanLine(line);
      if (/^do not use\b/i.test(text)) {
        const codes = extractInlineCodeItems(text);
        if (codes.length > 0) {
          for (const code of codes) pushUnique(values, code);
        } else {
          pushUnique(values, text);
        }
      } else {
        pushUnique(values, text);
      }
      continue;
    }

    maybeBucketLine(line, update);
  }

  return update;
}

export function resolveEditorialImportPath(
  source: EditorialImportSource,
  cwd = process.cwd(),
  explicitPath?: string
): string {
  if (source === "markdown") {
    if (!explicitPath) throw new Error("A markdown source path is required for `markdown` imports.");
    return resolve(cwd, explicitPath);
  }

  if (source === "auto") {
    for (const candidate of ["CLAUDE.md", "AGENTS.md", ".github/copilot-instructions.md", ".openclaw/NOTES.md"]) {
      const resolved = resolve(cwd, candidate);
      if (existsSync(resolved)) return resolved;
    }
    throw new Error(`No known markdown memory file found in ${cwd}`);
  }

  for (const candidate of SOURCE_CANDIDATES[source]) {
    const resolved = resolve(cwd, candidate);
    if (existsSync(resolved)) return resolved;
  }

  throw new Error(`No import source found for ${source} in ${cwd}`);
}

export async function importEditorialState(
  source: EditorialImportSource,
  options: { cwd?: string; inputPath?: string; stateFile?: string; dryRun?: boolean } = {}
): Promise<EditorialImportResult> {
  const cwd = options.cwd ?? process.cwd();
  const importPath = resolveEditorialImportPath(source, cwd, options.inputPath);
  const raw = await readFile(importPath, "utf8");
  const extracted = parseMarkdownEditorialState(raw);

  if (options.dryRun) {
    return {
      source,
      importPath,
      extracted,
    };
  }

  const writeResult = await updateEditorialState(extracted, {
    cwd,
    stateFile: options.stateFile,
    source: `import:${source}`,
  });

  return {
    source,
    importPath,
    extracted,
    status: writeResult.status,
    statePath: writeResult.path,
    backupPath: writeResult.backupPath,
  };
}
