import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ToolCall, ValidationResult } from "./types.js";
import { summary } from "./reporter.js";

function clip(value: unknown, max = 200): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

export function writeTelemetry(path: string | undefined, call: ToolCall, results: ValidationResult[]): void {
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  const counts = summary(results);
  const findings = results
    .filter((r) => r.status !== "pass")
    .slice(0, 10)
    .map((r) => ({ status: r.status, rule: r.rule, message: r.message }));
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
    findings,
    commandPreview: clip(call.params?.command ?? call.params?.cmd),
    pathPreview: clip(call.params?.path ?? call.params?.file_path),
    durationMs: typeof call.params?.durationMs === "number" ? call.params.durationMs : undefined,
  };
  appendFileSync(path, `${JSON.stringify(row)}\n`, "utf8");
}
