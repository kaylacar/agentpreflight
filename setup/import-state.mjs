#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { applyStateUpdate, scaffoldEditorial } from "./editorial-setup.mjs";

const SOURCE_CANDIDATES = {
  "claude-md": ["CLAUDE.md"],
  "agents-md": ["AGENTS.md"],
  "codex-notes": ["AGENTS.md", ".codex/notes.md"],
  "copilot-instructions": [".github/copilot-instructions.md"],
  openclaw: [".openclaw/NOTES.md", ".openclaw/README.md", ".openclaw/AGENTS.md"],
};

const SECTION_BUCKETS = [
  { pattern: /^(locked|approved|keep|must keep|must preserve|must include)\b/i, bucket: "locked" },
  { pattern: /^(banned|avoid|forbidden|rejected|do not use)\b/i, bucket: "banned" },
  { pattern: /^(required|required concepts|must mention|must include)\b/i, bucket: "requiredConcepts" },
  { pattern: /^(open|todo|unresolved|still open)\b/i, bucket: "open" },
];

function usage() {
  process.stdout.write(
    "Usage:\n" +
      "  agentpreflight-import auto [--cwd <path>] [--dry-run]\n" +
      "  agentpreflight-import claude-md|agents-md|codex-notes|copilot-instructions|openclaw\n" +
      "  agentpreflight-import markdown <path>\n"
  );
}

export function parseArgs(argv) {
  const out = {
    source: "auto",
    inputPath: "",
    cwd: process.cwd(),
    dryRun: false,
    json: false,
  };

  if (argv.length > 0 && !argv[0].startsWith("-")) {
    out.source = argv[0];
    argv = argv.slice(1);
  }
  if (out.source === "markdown" && argv.length > 0 && !argv[0].startsWith("-")) {
    out.inputPath = argv[0];
    argv = argv.slice(1);
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--cwd") out.cwd = path.resolve(argv[++i] || out.cwd);
    else if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--json") out.json = true;
    else if (arg === "--path") out.inputPath = argv[++i] || "";
    else if (arg === "--help" || arg === "-h") out.help = true;
  }

  return out;
}

function pushUnique(values, entry) {
  const text = String(entry || "").trim();
  if (!text) return;
  if (!values.some((value) => String(value).trim().toLowerCase() === text.toLowerCase())) {
    values.push(text);
  }
}

function cleanLine(line) {
  return line.replace(/^[-*+]\s+/, "").replace(/^\d+\.\s+/, "").trim();
}

function extractInlineCodes(text) {
  return [...text.matchAll(/`([^`]+)`/g)].map((match) => match[1].trim()).filter(Boolean);
}

function bucketFromHeading(line) {
  const heading = line.replace(/^#+\s*/, "").replace(/:$/, "").trim();
  for (const entry of SECTION_BUCKETS) {
    if (entry.pattern.test(heading)) return entry.bucket;
  }
  return undefined;
}

export function parseMarkdownState(raw) {
  const update = { locked: [], banned: [], requiredConcepts: [], open: [] };
  let activeBucket;

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (/^#{1,6}\s+/.test(line)) {
      activeBucket = bucketFromHeading(line);
      continue;
    }

    if (activeBucket && (/^[-*+]\s+/.test(line) || /^\d+\.\s+/.test(line))) {
      const text = cleanLine(line);
      const codes = /^do not use\b/i.test(text) ? extractInlineCodes(text) : [];
      if (codes.length > 0) {
        for (const code of codes) pushUnique(update[activeBucket], code);
      } else {
        pushUnique(update[activeBucket], text);
      }
      continue;
    }

    if (/^(do not|don't|never|avoid)\b/i.test(line)) {
      const codes = extractInlineCodes(line);
      if (codes.length > 0) {
        for (const code of codes) pushUnique(update.banned, code);
      } else {
        pushUnique(update.banned, cleanLine(line));
      }
      continue;
    }

    if (/^(must|always|required|need to|keep|preserve)\b/i.test(line)) {
      pushUnique(update.locked, cleanLine(line));
      continue;
    }

    if (/^(open|todo|unresolved)\b[:\-]/i.test(line)) {
      pushUnique(update.open, line.replace(/^(open|todo|unresolved)\b[:\-]?\s*/i, ""));
    }
  }

  return update;
}

export function resolveImportPath(source, cwd, inputPath = "") {
  if (source === "markdown") {
    if (!inputPath) throw new Error("A markdown path is required for `markdown` imports.");
    return path.resolve(cwd, inputPath);
  }

  if (source === "auto") {
    for (const candidate of ["CLAUDE.md", "AGENTS.md", ".github/copilot-instructions.md", ".openclaw/NOTES.md"]) {
      const full = path.resolve(cwd, candidate);
      if (existsSync(full)) return full;
    }
    throw new Error(`No known markdown memory file found in ${cwd}`);
  }

  for (const candidate of SOURCE_CANDIDATES[source] || []) {
    const full = path.resolve(cwd, candidate);
    if (existsSync(full)) return full;
  }

  throw new Error(`No import source found for ${source} in ${cwd}`);
}

export function runImport(args) {
  const importPath = resolveImportPath(args.source, args.cwd, args.inputPath);
  const raw = readFileSync(importPath, "utf8");
  const update = parseMarkdownState(raw);

  if (args.dryRun) {
    return { source: args.source, importPath, update };
  }

  const statePath = path.join(args.cwd, ".preflight", "editorial-state.json");
  scaffoldEditorial(args.cwd);
  const result = applyStateUpdate(statePath, update, { source: `import:${args.source}` });
  return { source: args.source, importPath, update, ...result };
}

export function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    process.exit(0);
  }

  try {
    const result = runImport(args);
    if (args.json || args.dryRun) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    process.stdout.write(`Imported: ${result.importPath}\n`);
    process.stdout.write(`Status: ${result.status}\n`);
    if (result.historyPath) process.stdout.write(`History: ${result.historyPath}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Import failed";
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}

const isDirectRun =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectRun) {
  main();
}
