#!/usr/bin/env node
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function assert(condition, message) {
  if (!condition) {
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}

async function main() {
  const dist = path.resolve(process.cwd(), "dist", "index.js");
  assert(existsSync(dist), "guardrail check failed: dist/index.js missing; run npm run build first");

  const sdk = await import(pathToFileURL(dist).href);
  const { createPreflight, hasFailures } = sdk;
  const pf = createPreflight({
    policyMode: "enforce",
    telemetryPath: ".preflight/telemetry.jsonl",
  });

  const allowResults = await pf.validateWithPolicy({
    tool: "bash",
    params: { command: "git status --short", cmd: "git status --short" },
    source: "raw",
  });
  assert(!hasFailures(allowResults), "guardrail check failed: preflight should allow git status --short");

  const blockResults = await pf.validateWithPolicy({
    tool: "bash",
    params: { command: "git push --force origin main", cmd: "git push --force origin main" },
    source: "raw",
  });
  assert(hasFailures(blockResults), "guardrail check failed: preflight should block force push to main");

  process.stdout.write("guardrail contract checks passed\n");
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exit(1);
});
