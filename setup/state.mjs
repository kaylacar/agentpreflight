#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { applyStateUpdate, loadStateHistory, openEditor, readJson, scaffoldEditorial } from "./editorial-setup.mjs";

function usage() {
  process.stdout.write(
    "Usage:\n" +
      "  agentpreflight-state init [--cwd <path>] [--edit]\n" +
      "  agentpreflight-state lock <text...>\n" +
      "  agentpreflight-state ban <text...>\n" +
      "  agentpreflight-state require <text...>\n" +
      "  agentpreflight-state open <text...>\n" +
      "  agentpreflight-state artifact <name>\n" +
      "  agentpreflight-state show [--json]\n" +
      "  agentpreflight-state history [--limit <n>]\n" +
      "  agentpreflight-state edit\n"
  );
}

export function parseArgs(argv) {
  const out = {
    command: "",
    values: [],
    cwd: process.cwd(),
    edit: false,
    json: false,
    limit: 20,
  };

  if (argv.length > 0 && !argv[0].startsWith("-")) {
    out.command = argv[0];
    argv = argv.slice(1);
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--cwd") out.cwd = path.resolve(argv[++i] || out.cwd);
    else if (arg === "--edit") out.edit = true;
    else if (arg === "--json") out.json = true;
    else if (arg === "--limit") out.limit = Number(argv[++i] || out.limit);
    else if (arg === "--help" || arg === "-h") out.help = true;
    else out.values.push(arg);
  }

  return out;
}

function statePathFor(cwd) {
  return path.join(cwd, ".preflight", "editorial-state.json");
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function runStateCommand(args) {
  const statePath = statePathFor(args.cwd);

  if (args.command === "init" || !args.command) {
    const result = scaffoldEditorial(args.cwd);
    if (args.edit) openEditor(result.statePath);
    return result;
  }

  if (args.command === "show") {
    scaffoldEditorial(args.cwd);
    const state = readJson(statePath);
    if (args.json) printJson(state);
    else process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
    return { state };
  }

  if (args.command === "history") {
    scaffoldEditorial(args.cwd);
    const history = loadStateHistory(statePath, args.limit);
    if (args.json) printJson(history);
    else {
      for (const entry of history) {
        process.stdout.write(`${entry.timestamp} ${entry.status} ${JSON.stringify(entry.update)}\n`);
      }
    }
    return { history };
  }

  if (args.command === "edit") {
    const result = scaffoldEditorial(args.cwd);
    openEditor(result.statePath);
    return result;
  }

  scaffoldEditorial(args.cwd);

  const update = {
    artifact: undefined,
    locked: [],
    banned: [],
    requiredConcepts: [],
    open: [],
  };

  if (args.command === "lock") update.locked = args.values;
  else if (args.command === "ban") update.banned = args.values;
  else if (args.command === "require") update.requiredConcepts = args.values;
  else if (args.command === "open") update.open = args.values;
  else if (args.command === "artifact") update.artifact = args.values.join(" ").trim();
  else throw new Error(`Unknown state command: ${args.command}`);

  return applyStateUpdate(statePath, update, { source: `state:${args.command}` });
}

export function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    process.exit(0);
  }

  try {
    const result = runStateCommand(args);
    if (args.command === "history" || args.command === "show") return;
    if (result.statePath) process.stdout.write(`State: ${result.statePath}\n`);
    if (result.historyPath) process.stdout.write(`History: ${result.historyPath}\n`);
    if (result.status) process.stdout.write(`Status: ${result.status}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "State command failed";
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}

const isDirectRun =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectRun) {
  main();
}
