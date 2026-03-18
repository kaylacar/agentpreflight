import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ToolCall, ValidationResult } from "./types.js";
import { summary } from "./reporter.js";

export function writeTelemetry(path: string | undefined, call: ToolCall, results: ValidationResult[]): void {
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  const counts = summary(results);
  const topRules = [...results]
    .filter((r) => r.status !== "pass")
    .map((r) => r.rule)
    .slice(0, 5);
  const row = {
    ts: new Date().toISOString(),
    tool: call.tool,
    source: call.source || "raw",
    status: counts.fail > 0 ? "blocked" : counts.warn > 0 ? "warn" : "pass",
    counts,
    topRules,
    durationMs: typeof call.params?.durationMs === "number" ? call.params.durationMs : undefined,
  };
  appendFileSync(path, `${JSON.stringify(row)}\n`, "utf8");
}
