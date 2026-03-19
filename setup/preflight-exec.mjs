#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function usage() {
  process.stderr.write(
    "Usage:\n" +
      "  npm run preflight:exec -- --command \"<shell command>\"\n" +
      "  npm run preflight:exec -- --tool bash --command \"<shell command>\"\n" +
      "  npm run preflight:exec -- --cwd \"<absolute path>\" --command \"<shell command>\"\n" +
      "  npm run preflight:exec -- --cwd \"<absolute path>\" --arg <cmd> [--arg <arg> ...]\n"
  );
}

export function parseArgs(argv) {
  const out = { tool: "bash", command: "", cwd: "", args: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--tool") out.tool = argv[++i] || out.tool;
    else if (arg === "--command") out.command = argv[++i] || "";
    else if (arg === "--cwd") out.cwd = argv[++i] || "";
    else if (arg === "--arg") out.args.push(argv[++i] || "");
  }
  out.args = out.args.filter(Boolean);
  if (!out.command && out.args.length > 0) {
    out.command = out.args.map((part) => String(part)).join(" ");
  }
  return out;
}

export function normalizeShellCommand(platform, command) {
  if (platform === "win32") {
    return { file: "cmd.exe", args: ["/d", "/s", "/c", command] };
  }
  return { file: "sh", args: ["-lc", command] };
}

async function loadSdk() {
  const dist = path.resolve(process.cwd(), "dist", "index.js");
  if (!existsSync(dist)) {
    process.stderr.write("dist/index.js missing. Run: npm run build\n");
    process.exit(2);
  }
  return import(pathToFileURL(dist).href);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.command) {
    usage();
    process.exit(2);
  }

  const sdk = await loadSdk();
  const { createPreflight, hasFailures, explainBlock } = sdk;
  const pf = createPreflight({
    policyMode: "enforce",
    telemetryPath: ".preflight/telemetry.jsonl",
  });
  const targetCwd = args.cwd ? path.resolve(args.cwd) : process.cwd();

  const call = {
    tool: args.tool,
    params: { command: args.command, cmd: args.command },
    source: "raw",
  };

  const { results, blocked, patchedCall } = await pf.preflightCommand(call);
  if (blocked || hasFailures(results)) {
    process.stderr.write(`agentpreflight blocked execution\n${explainBlock(results)}\n`);
    process.exit(1);
  }

  const finalCommand =
    (patchedCall && typeof patchedCall.params.command === "string" && patchedCall.params.command) ||
    args.command;
  const normalized = normalizeShellCommand(process.platform, finalCommand);
  const child = spawnSync(normalized.file, normalized.args, {
    stdio: "inherit",
    cwd: targetCwd,
    env: process.env,
  });

  if (typeof child.status === "number") {
    process.exit(child.status);
  }
  if (child.error) {
    process.stderr.write(
      `agentpreflight execution error\nshell=${normalized.file}\ncwd=${targetCwd}\ncommand=${finalCommand}\nerror=${child.error.message}\n`
    );
  }
  process.exit(1);
}

const isDirectRun =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectRun) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exit(1);
  });
}
