#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function usage() {
  process.stderr.write(
      "Usage:\n" +
      "  npm run preflight:overnight -- --plan .preflight/overnight.plan.json\n" +
      "  npm run preflight:overnight -- --plan <path> --state .preflight/overnight.state.json --handoff .preflight/agent-log.md [--reset]\n"
  );
}

function parseArgs(argv) {
  const out = {
    plan: "",
    state: ".preflight/overnight.state.json",
    handoff: ".preflight/agent-log.md",
    reset: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--plan") out.plan = argv[++i] || "";
    else if (arg === "--state") out.state = argv[++i] || out.state;
    else if (arg === "--handoff") out.handoff = argv[++i] || out.handoff;
    else if (arg === "--reset") out.reset = true;
  }
  return out;
}

function loadJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function resolveSdkDistPath() {
  return path.resolve(__dirname, "..", "dist", "index.js");
}

async function loadSdk() {
  const dist = resolveSdkDistPath();
  if (!existsSync(dist)) {
    process.stderr.write(`dist/index.js missing: ${dist}\n`);
    process.exit(2);
  }
  return import(pathToFileURL(dist).href);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.plan) {
    usage();
    process.exit(2);
  }
  if (!existsSync(args.plan)) {
    process.stderr.write(`Plan file not found: ${args.plan}\n`);
    process.exit(2);
  }

  const sdk = await loadSdk();
  const { createPreflight, runOvernightPlan, persistRunState, createPlatformExecutor, resolveInitialOvernightState } = sdk;

  const plan = loadJson(args.plan);
  const storedState = existsSync(args.state) ? loadJson(args.state) : undefined;
  const { initialState, resetApplied } = resolveInitialOvernightState(storedState, args.reset);
  if (resetApplied && storedState && !args.reset) {
    process.stdout.write(`State version mismatch (${storedState.stateVersion}); starting fresh state\n`);
  }
  if (args.reset) {
    process.stdout.write("State reset requested; starting fresh state\n");
  }
  const preflight = createPreflight({
    policyMode: "enforce",
    telemetryPath: ".preflight/telemetry.jsonl",
  });
  const executor = createPlatformExecutor({
    cwd: process.cwd(),
    env: process.env,
  });

  const finalState = await runOvernightPlan(plan, {
    preflight,
    executor,
    initialState,
    handoffLogPath: args.handoff,
    onState: (state) => persistRunState(args.state, state),
  });

  process.stdout.write(
    `\nRun status: ${finalState.status}\nCompleted chunks: ${finalState.completedChunks}/${finalState.chunks.length}\n`
  );
  if (finalState.blockers.length > 0) {
    for (const blocker of finalState.blockers) {
      process.stderr.write(`Blocker [${blocker.chunkId}]: ${blocker.message}\n`);
    }
  }

  process.exit(finalState.status === "completed" ? 0 : 1);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exit(1);
});
