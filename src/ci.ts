import { readFile } from "node:fs/promises";
import type { Preflight } from "./types.js";
import { hasFailures } from "./reporter.js";

export interface ReplayRow {
  tool: string;
  params: Record<string, unknown>;
  agentId?: string;
}

export async function replayToolCallsFromFile(preflight: Preflight, path: string): Promise<{
  total: number;
  failed: number;
  passed: number;
}> {
  const raw = await readFile(path, "utf8");
  const rows = JSON.parse(raw) as ReplayRow[];
  let failed = 0;
  let passed = 0;
  for (const row of rows) {
    const results = await preflight.validateWithPolicy({
      tool: row.tool,
      params: row.params,
      agentId: row.agentId,
      source: "raw",
    });
    if (hasFailures(results)) failed += 1;
    else passed += 1;
  }
  return { total: rows.length, failed, passed };
}
