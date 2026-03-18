#!/usr/bin/env node
import { createPreflight, replayToolCallsFromFile } from "../dist/index.js";

const file = process.argv[2];
if (!file) {
  process.stderr.write("Usage: npm run preflight:ci -- <tool-calls.json>\n");
  process.exit(2);
}

const pf = createPreflight({
  policyMode: "enforce",
});

const result = await replayToolCallsFromFile(pf, file);
process.stdout.write(
  `preflight-ci total=${result.total} passed=${result.passed} failed=${result.failed}\n`
);
if (result.failed > 0) {
  process.exit(1);
}
