import { createPreflight, hasFailures, formatResults, adaptToolCall } from "../../../dist/index.js";

const pf = createPreflight({
  policyMode: "enforce",
  telemetryPath: ".preflight/telemetry.jsonl",
});

export default async function handler(event) {
  const payload = event?.payload || event || {};
  const call = adaptToolCall(payload, "openclaw");
  const results = await pf.validateWithPolicy(call);
  if (hasFailures(results)) {
    return {
      ok: false,
      blocked: true,
      message: formatResults(results),
    };
  }
  return { ok: true, blocked: false };
}
