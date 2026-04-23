#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { setupClaudeHook } from "./claude-hook.mjs";
import { setupOpenClaw } from "./openclaw-setup.mjs";
import { setupCodex } from "./codex-setup.mjs";

function usage() {
  process.stdout.write(
    "Usage:\n" +
      "  agentpreflight-setup-hooks --agent claude|openclaw|codex|all [--cwd <path>]\n"
  );
}

export function parseArgs(argv) {
  const out = { agent: "all", cwd: process.cwd() };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--agent") out.agent = argv[++i] || out.agent;
    else if (arg === "--cwd") out.cwd = path.resolve(argv[++i] || out.cwd);
    else if (arg === "--help" || arg === "-h") out.help = true;
  }
  return out;
}

export async function runHookSetup(args) {
  const targets = args.agent === "all" ? ["claude", "openclaw", "codex"] : [args.agent];
  const results = [];

  for (const target of targets) {
    if (target === "claude") results.push({ agent: target, result: await setupClaudeHook() });
    else if (target === "openclaw") results.push({ agent: target, result: setupOpenClaw({ cwd: args.cwd }) });
    else if (target === "codex") results.push({ agent: target, result: setupCodex() });
    else throw new Error(`Unknown agent target: ${target}`);
  }

  return results;
}

export async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    process.exit(0);
  }

  try {
    const results = await runHookSetup(args);
    process.stdout.write("agentpreflight hook setup complete.\n");
    for (const entry of results) {
      process.stdout.write(`${entry.agent}: ok\n`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Hook setup failed";
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}

const isDirectRun =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectRun) {
  main();
}
