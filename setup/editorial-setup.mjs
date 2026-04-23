#!/usr/bin/env node
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = process.cwd();
const templatesDir = path.resolve(__dirname, "..", "templates");

function usage() {
  process.stdout.write(
    "Usage:\n" +
      "  npm run setup:editorial\n" +
      "  npm run setup:editorial -- --edit\n" +
      "  npm run setup:editorial -- --cwd <path> [--edit]\n" +
      "  npm run setup:editorial -- --locked \"<text>\" [--locked \"<text>\" ...]\n" +
      "  npm run setup:editorial -- --banned \"<text>\" [--required \"<text>\" --open \"<text>\" --artifact <name>]\n"
  );
}

function parseArgs(argv) {
  const out = { cwd: root, edit: false, locked: [], banned: [], requiredConcepts: [], open: [], artifact: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--cwd") out.cwd = path.resolve(argv[++i] || root);
    else if (arg === "--edit") out.edit = true;
    else if (arg === "--artifact") out.artifact = argv[++i] || "";
    else if (arg === "--locked") out.locked.push(argv[++i] || "");
    else if (arg === "--banned") out.banned.push(argv[++i] || "");
    else if (arg === "--required") out.requiredConcepts.push(argv[++i] || "");
    else if (arg === "--open") out.open.push(argv[++i] || "");
    else if (arg === "--help" || arg === "-h") out.help = true;
  }
  return out;
}

function readTemplate(name) {
  return readFileSync(path.join(templatesDir, name), "utf8");
}

export function readJson(filePath) {
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("Expected top-level JSON object");
    }
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON";
    throw new Error(`Invalid JSON in existing scaffold file: ${filePath} (${message})`);
  }
}

function makeBackupPath(filePath) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${filePath}.bak.${stamp}`;
}

export function resolveHistoryPath(filePath) {
  const ext = path.extname(filePath);
  if (ext === ".json") {
    return path.join(path.dirname(filePath), `${path.basename(filePath, ext)}.history.jsonl`);
  }
  return `${filePath}.history.jsonl`;
}

function appendHistoryEntry(filePath, entry) {
  const historyPath = resolveHistoryPath(filePath);
  mkdirSync(path.dirname(historyPath), { recursive: true });
  appendFileSync(historyPath, `${JSON.stringify(entry)}\n`, "utf8");
  return historyPath;
}

function backupFile(filePath) {
  const backupPath = makeBackupPath(filePath);
  copyFileSync(filePath, backupPath);
  return backupPath;
}

export function mergeTemplateData(existing, template) {
  if (Array.isArray(template)) {
    if (!Array.isArray(existing)) return template;
    const merged = [...existing];
    const seen = new Set(existing.map((entry) => JSON.stringify(entry)));
    for (const entry of template) {
      const key = JSON.stringify(entry);
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(entry);
      }
    }
    return merged;
  }

  if (template && typeof template === "object") {
    const base = existing && typeof existing === "object" && !Array.isArray(existing) ? { ...existing } : {};
    for (const [key, value] of Object.entries(template)) {
      if (key in base) base[key] = mergeTemplateData(base[key], value);
      else base[key] = value;
    }
    return base;
  }

  return existing === undefined ? template : existing;
}

function normalizeEntry(entry) {
  if (Array.isArray(entry)) return JSON.stringify(entry.map((item) => String(item).trim().toLowerCase()));
  return String(entry).trim().toLowerCase();
}

function appendUniqueEntries(existing, additions) {
  const base = Array.isArray(existing) ? [...existing] : [];
  const incoming = Array.isArray(additions) ? additions.map((value) => String(value).trim()).filter(Boolean) : [];
  const seen = new Set(base.map(normalizeEntry));
  for (const entry of incoming) {
    const key = normalizeEntry(entry);
    if (!seen.has(key)) {
      seen.add(key);
      base.push(entry);
    }
  }
  return base;
}

export function scaffoldJsonFile(filePath, templateName) {
  const template = JSON.parse(readTemplate(templateName));
  mkdirSync(path.dirname(filePath), { recursive: true });
  if (!existsSync(filePath)) {
    writeFileSync(filePath, `${JSON.stringify(template, null, 2)}\n`, "utf8");
    return { status: "created" };
  }

  let existing;
  try {
    existing = readJson(filePath);
  } catch {
    const backupPath = backupFile(filePath);
    writeFileSync(filePath, `${JSON.stringify(template, null, 2)}\n`, "utf8");
    return { status: "repaired", backupPath };
  }

  const merged = mergeTemplateData(existing, template);
  const before = JSON.stringify(existing);
  const after = JSON.stringify(merged);
  if (before === after) return { status: "unchanged" };
  writeFileSync(filePath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  return { status: "updated" };
}

export function applyStateUpdate(filePath, update, options = {}) {
  const existing = readJson(filePath);
  const merged = {
    artifact: update.artifact || existing.artifact,
    locked: appendUniqueEntries(existing.locked, update.locked),
    banned: appendUniqueEntries(existing.banned, update.banned),
    requiredConcepts: appendUniqueEntries(existing.requiredConcepts, update.requiredConcepts),
    open: appendUniqueEntries(existing.open, update.open),
  };
  const before = JSON.stringify(existing);
  const after = JSON.stringify(merged);
  let status = options.initialStatus || "unchanged";
  if (before !== after) {
    status = "updated";
    writeFileSync(filePath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  }

  if (status !== "unchanged") {
    const historyPath = appendHistoryEntry(filePath, {
      timestamp: new Date().toISOString(),
      status,
      statePath: filePath,
      update,
      source: options.source,
      backupPath: options.backupPath,
    });
    return { status, state: merged, historyPath };
  }

  return { status, state: merged, historyPath: resolveHistoryPath(filePath) };
}

export function loadStateHistory(filePath, limit = 20) {
  const historyPath = resolveHistoryPath(filePath);
  if (!existsSync(historyPath)) return [];
  return readFileSync(historyPath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .slice(-Math.max(limit, 1));
}

export function openEditor(filePath) {
  const editor = process.env.EDITOR || process.env.VISUAL;
  if (editor) {
    const result = spawnSync(editor, [filePath], { stdio: "inherit", shell: true });
    return !result.error;
  }

  if (process.platform === "win32") {
    const result = spawnSync("notepad.exe", [filePath], { stdio: "inherit" });
    return !result.error;
  }

  if (process.platform === "darwin") {
    const result = spawnSync("open", ["-W", filePath], { stdio: "inherit" });
    return !result.error;
  }

  const result = spawnSync("nano", [filePath], { stdio: "inherit" });
  return !result.error;
}

export function scaffoldEditorial(targetCwd, stateUpdate = {}) {
  const preflightDir = path.join(targetCwd, ".preflight");
  const statePath = path.join(preflightDir, "editorial-state.json");
  const policyPath = path.join(preflightDir, "editorial.preflight.policy.json");

  mkdirSync(preflightDir, { recursive: true });
  const stateResult = scaffoldJsonFile(statePath, "editorial-state.json");
  const policyResult = scaffoldJsonFile(policyPath, "editorial.preflight.policy.json");
  const updateResult = applyStateUpdate(statePath, stateUpdate, {
    initialStatus: stateResult.status,
    backupPath: stateResult.backupPath,
    source: "setup:editorial",
  });

  return {
    preflightDir,
    statePath,
    policyPath,
    historyPath: updateResult.historyPath,
    stateStatus: stateResult.status,
    policyStatus: policyResult.status,
    stateUpdateStatus: updateResult.status,
    stateBackupPath: stateResult.backupPath,
    policyBackupPath: policyResult.backupPath,
  };
}

export function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    process.exit(0);
  }

  let statePath;
  let policyPath;
  let historyPath;
  let stateStatus;
  let policyStatus;
  let stateUpdateStatus;
  let stateBackupPath;
  let policyBackupPath;
  try {
    ({
      statePath,
      policyPath,
      historyPath,
      stateStatus,
      policyStatus,
      stateUpdateStatus,
      stateBackupPath,
      policyBackupPath,
    } = scaffoldEditorial(args.cwd, {
      artifact: args.artifact,
      locked: args.locked,
      banned: args.banned,
      requiredConcepts: args.requiredConcepts,
      open: args.open,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Editorial scaffold failed";
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }

  process.stdout.write("Editorial preflight scaffold complete.\n");
  process.stdout.write(`State: ${statePath} (${stateStatus})\n`);
  process.stdout.write(`Policy: ${policyPath} (${policyStatus})\n`);
  process.stdout.write(`State entries: ${stateUpdateStatus}\n`);
  process.stdout.write(`History: ${historyPath}\n`);
  if (stateBackupPath) process.stdout.write(`State backup: ${stateBackupPath}\n`);
  if (policyBackupPath) process.stdout.write(`Policy backup: ${policyBackupPath}\n`);
  process.stdout.write("Use this policy by passing `policyPackPath: \".preflight/editorial.preflight.policy.json\"`.\n");

  if (args.edit) {
    process.stdout.write(`Opening editor for ${statePath}\n`);
    if (!openEditor(statePath)) {
      process.stdout.write("Could not open an editor automatically. Edit the state file manually.\n");
    }
  } else {
    process.stdout.write("Next: edit the state file or rerun with `--edit`.\n");
  }
}

const isDirectRun =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectRun) {
  main();
}
