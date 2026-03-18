#!/usr/bin/env node
import { createPreflight, hasFailures, formatResults, adaptToolCall } from "../dist/index.js";

const pf = createPreflight({
  policyMode: "enforce",
  telemetryPath: ".preflight/telemetry.jsonl",
});

let raw = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) raw += chunk;

if (!raw.trim()) process.exit(0);

let input;
try {
  input = JSON.parse(raw);
} catch {
  process.exit(0);
}

const call = adaptToolCall(input, "openclaw");
const results = await pf.validateWithPolicy(call);

if (hasFailures(results)) {
  process.stderr.write(`agentpreflight blocked ${call.tool}:\n${formatResults(results)}\n`);
  process.exit(2);
}

process.stdout.write(JSON.stringify({ ok: true, preflight: "pass" }));
process.exit(0);
