#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function usage() {
  process.stderr.write(
    "Usage:\n" +
      "  node setup/codex-preflight.mjs < codex-tool-call.json\n" +
      "  node setup/codex-preflight.mjs --file codex-tool-call.json\n" +
      "  node setup/codex-preflight.mjs --tool functions.shell_command --params-json '{\"command\":\"git status\"}'\n" +
      "  node setup/codex-preflight.mjs --cwd C:/repo --telemetry .preflight/telemetry.jsonl < codex-tool-call.json\n"
  );
}

function parseArgs(argv) {
  const out = {
    cwd: process.cwd(),
    telemetryPath: ".preflight/telemetry.jsonl",
    file: "",
    tool: "",
    paramsJson: "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--cwd") out.cwd = argv[++i] || out.cwd;
    else if (arg === "--telemetry") out.telemetryPath = argv[++i] || out.telemetryPath;
    else if (arg === "--file") out.file = argv[++i] || "";
    else if (arg === "--tool") out.tool = argv[++i] || "";
    else if (arg === "--params-json") out.paramsJson = argv[++i] || "";
    else if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    }
  }

  return out;
}

function readStdin() {
  if (process.stdin.isTTY) return "";
  return readFileSync(0, "utf8").trim();
}

function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON";
    throw new Error(`${label} is not valid JSON: ${message}`);
  }
}

function payloadsFrom(input) {
  const payload = input && typeof input === "object" ? input : {};
  const tool = String(payload.tool || payload.recipient_name || payload.name || "");
  const params = payload.parameters || payload.params || {};
  if (
    tool === "multi_tool_use.parallel" &&
    params &&
    typeof params === "object" &&
    Array.isArray(params.tool_uses)
  ) {
    return params.tool_uses;
  }
  return [input];
}

function resolveSdkDistPath() {
  return path.resolve(__dirname, "..", "dist", "index.js");
}

async function loadSdk() {
  const dist = resolveSdkDistPath();
  if (!existsSync(dist)) {
    process.stderr.write(`dist/index.js missing: ${dist}\nRun npm run build first.\n`);
    process.exit(2);
  }
  return import(pathToFileURL(dist).href);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const stdin = readStdin();
  let input;

  if (args.file) {
    input = parseJson(readFileSync(path.resolve(args.file), "utf8"), "--file");
  } else if (stdin) {
    input = parseJson(stdin, "stdin");
  } else if (args.tool) {
    input = {
      recipient_name: args.tool,
      parameters: args.paramsJson ? parseJson(args.paramsJson, "--params-json") : {},
    };
  } else {
    usage();
    process.exit(2);
  }

  const sdk = await loadSdk();
  const { validateAdapted, hasFailures, formatResults } = sdk;
  const payloads = payloadsFrom(input);
  let blocked = false;

  for (const payload of payloads) {
    const results = await validateAdapted(payload, "codex", {
      cwd: path.resolve(args.cwd),
      telemetryPath: args.telemetryPath,
      telemetryRequired: true,
    });

    if (hasFailures(results)) {
      blocked = true;
      process.stderr.write(`agentpreflight blocked Codex tool call\n${formatResults(results)}\n`);
    }
  }

  if (blocked) process.exit(1);
  process.stdout.write(`agentpreflight codex validation passed (${payloads.length} call${payloads.length === 1 ? "" : "s"})\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exit(1);
});
