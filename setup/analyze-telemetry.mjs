#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

function usage() {
  process.stderr.write(
    "Usage:\n" +
      "  node setup/analyze-telemetry.mjs --file .preflight/telemetry.jsonl [--output .preflight/metrics-report.md]\n"
  );
}

function parseArgs(argv) {
  const out = {
    file: ".preflight/telemetry.jsonl",
    output: "",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--file") out.file = argv[++i] || out.file;
    else if (arg === "--output") out.output = argv[++i] || "";
  }
  return out;
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function parseRows(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`Telemetry file not found: ${filePath}`);
  }
  const lines = readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.map((line) => JSON.parse(line));
}

function summarize(rows) {
  const total = rows.length;
  const blocked = rows.filter((r) => r.status === "blocked").length;
  const warned = rows.filter((r) => r.status === "warn").length;
  const passed = rows.filter((r) => r.status === "pass").length;

  const byRule = new Map();
  for (const row of rows) {
    const rules = Array.isArray(row.topRules) ? row.topRules : [];
    for (const rule of rules) {
      byRule.set(rule, (byRule.get(rule) || 0) + 1);
    }
  }
  const topBlockedRules = [...byRule.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([rule, count]) => ({ rule, count }));

  const durations = rows
    .map((r) => (typeof r.durationMs === "number" ? r.durationMs : null))
    .filter((v) => v !== null);
  const avgOverheadMs =
    durations.length > 0 ? Number((durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(2)) : null;

  return {
    total,
    blocked,
    warned,
    passed,
    blockedRatePct: total > 0 ? Number(((blocked / total) * 100).toFixed(2)) : 0,
    falsePositiveRatePct: null,
    avgOverheadMs,
    p95OverheadMs: durations.length > 0 ? percentile(durations, 95) : null,
    topBlockedRules,
  };
}

function toMarkdown(summaryData, sourcePath) {
  const lines = [];
  lines.push("# Preflight Metrics Report");
  lines.push("");
  lines.push(`- source: \`${sourcePath}\``);
  lines.push(`- generated_at: \`${new Date().toISOString()}\``);
  lines.push("");
  lines.push("## Core Metrics");
  lines.push("");
  lines.push(`- blocked count: **${summaryData.blocked}**`);
  lines.push(`- total validations: **${summaryData.total}**`);
  lines.push(`- blocked rate: **${summaryData.blockedRatePct}%**`);
  lines.push(
    `- false positive rate: **${
      summaryData.falsePositiveRatePct === null
        ? "N/A (requires labeled review set)"
        : `${summaryData.falsePositiveRatePct}%`
    }**`
  );
  lines.push(
    `- avg overhead per command (ms): **${
      summaryData.avgOverheadMs === null ? "N/A (durationMs not logged yet)" : summaryData.avgOverheadMs
    }**`
  );
  lines.push(
    `- p95 overhead per command (ms): **${
      summaryData.p95OverheadMs === null ? "N/A (durationMs not logged yet)" : summaryData.p95OverheadMs
    }**`
  );
  lines.push("");
  lines.push("## Top Blocked Rules");
  lines.push("");
  if (summaryData.topBlockedRules.length === 0) {
    lines.push("- none");
  } else {
    for (const row of summaryData.topBlockedRules) {
      lines.push(`- ${row.rule}: ${row.count}`);
    }
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("- False-positive rate must be computed from a manually reviewed sample of blocked events.");
  lines.push("- Overhead metrics require telemetry rows to include `durationMs`.");
  return `${lines.join("\n")}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) {
    usage();
    process.exit(2);
  }

  const rows = parseRows(args.file);
  const summaryData = summarize(rows);
  const report = toMarkdown(summaryData, path.resolve(args.file));
  if (args.output) {
    writeFileSync(args.output, report, "utf8");
    process.stdout.write(`Wrote metrics report: ${args.output}\n`);
  } else {
    process.stdout.write(report);
  }
}

main();
