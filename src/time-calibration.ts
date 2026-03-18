import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export interface TimeEstimateRecord {
  taskId: string;
  bestCaseMinutes: number;
  p90Minutes: number;
  actualMinutes: number;
  ts: string;
}

export function recordTimeEstimate(path: string, row: Omit<TimeEstimateRecord, "ts">): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify({ ...row, ts: new Date().toISOString() })}\n`, "utf8");
}

export function estimateDrift(path: string): { total: number; p90MissRate: number; avgErrorPct: number } {
  const raw = readFileSync(path, "utf8");
  const rows = raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TimeEstimateRecord);
  if (rows.length === 0) return { total: 0, p90MissRate: 0, avgErrorPct: 0 };
  const p90Misses = rows.filter((r) => r.actualMinutes > r.p90Minutes).length;
  const avgErrorPct =
    rows.reduce((sum, r) => {
      const baseline = Math.max(1, r.p90Minutes);
      return sum + Math.abs(r.actualMinutes - r.p90Minutes) / baseline;
    }, 0) / rows.length;
  return {
    total: rows.length,
    p90MissRate: p90Misses / rows.length,
    avgErrorPct,
  };
}
