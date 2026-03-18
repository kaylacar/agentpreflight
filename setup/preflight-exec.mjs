#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function usage() {
  process.stderr.write(
    "Usage:\n" +
      "  npm run preflight:exec -- --command \"<shell command>\"\n" +
      "  npm run preflight:exec -- --tool bash --command \"<shell command>\"\n"
  );
}

function parseArgs(argv) {
  const out = { tool: "bash", command: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--tool") out.tool = argv[++i] || out.tool;
    else if (arg === "--command") out.command = argv[++i] || "";
  }
  return out;
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

  const child = spawnSync(finalCommand, {
    shell: true,
    stdio: "inherit",
    cwd: process.cwd(),
    env: process.env,
  });

  if (typeof child.status === "number") {
    process.exit(child.status);
  }
  process.exit(1);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exit(1);
});
