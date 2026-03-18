#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";

function parseArgs(argv) {
  const out = {
    file: ".preflight/telemetry.jsonl",
    outputCsv: ".preflight/fp-review.csv",
    outputJson: ".preflight/fp-summary.json",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--file") out.file = argv[++i] || out.file;
    else if (arg === "--output-csv") out.outputCsv = argv[++i] || out.outputCsv;
    else if (arg === "--output-json") out.outputJson = argv[++i] || out.outputJson;
  }
  return out;
}

function readRows(filePath) {
  if (!existsSync(filePath)) throw new Error(`Telemetry file not found: ${filePath}`);
  return readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function classifyBlocked(row) {
  const rules = new Set((row.findings || []).map((f) => f.rule).concat(row.topRules || []));
  const command = String(row.commandPreview || "");
  const reasons = [];

  const highConfidenceTrue = [
    "force-push-protection",
    "secrets-in-file-content",
    "session-destructive-checkpoint",
    "staging-verification",
    "release-claim-requires-evidence",
  ];

  for (const rule of highConfidenceTrue) {
    if (rules.has(rule)) {
      reasons.push(`high-confidence-true:${rule}`);
      return { label: "likely_true_block", confidence: "high", reason: reasons.join("|") };
    }
  }

  if (rules.has("platform-path-sep") || rules.has("onedrive-redirect") || rules.has("repo-path-resolution")) {
    reasons.push("path-normalization-rule");
    return { label: "needs_human_review", confidence: "medium", reason: reasons.join("|") };
  }

  if (command.includes("echo ") || command.includes("git status")) {
    reasons.push("low-risk-command");
    return { label: "likely_false_positive", confidence: "low", reason: reasons.join("|") };
  }

  return { label: "needs_human_review", confidence: "medium", reason: "default-review" };
}

function toCsv(rows) {
  const header = [
    "ts",
    "tool",
    "status",
    "rules",
    "command_preview",
    "label",
    "confidence",
    "reason",
    "human_label",
    "notes",
  ];
  const lines = [header.join(",")];
  for (const row of rows) {
    const rules = (row.findings || []).map((f) => f.rule).join("|") || (row.topRules || []).join("|");
    const cls = classifyBlocked(row);
    const cells = [
      row.ts || "",
      row.tool || "",
      row.status || "",
      rules,
      row.commandPreview || "",
      cls.label,
      cls.confidence,
      cls.reason,
      "",
      "",
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`);
    lines.push(cells.join(","));
  }
  return `${lines.join("\n")}\n`;
}

function summarize(rows) {
  const blocked = rows.filter((r) => r.status === "blocked");
  const labels = blocked.map(classifyBlocked);
  const count = (name) => labels.filter((l) => l.label === name).length;
  return {
    blockedTotal: blocked.length,
    likelyTrueBlocks: count("likely_true_block"),
    likelyFalsePositives: count("likely_false_positive"),
    needsHumanReview: count("needs_human_review"),
    estimatedFalsePositiveRatePct:
      blocked.length > 0 ? Number(((count("likely_false_positive") / blocked.length) * 100).toFixed(2)) : 0,
    note: "Estimated rate from auto-labels. Final FP rate requires human_label adjudication in fp-review.csv.",
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const rows = readRows(args.file);
  const blockedRows = rows.filter((r) => r.status === "blocked");
  const csv = toCsv(blockedRows);
  const summary = summarize(rows);
  writeFileSync(args.outputCsv, csv, "utf8");
  writeFileSync(args.outputJson, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  process.stdout.write(`Wrote review CSV: ${args.outputCsv}\n`);
  process.stdout.write(`Wrote summary JSON: ${args.outputJson}\n`);
  process.stdout.write(`Blocked events: ${summary.blockedTotal}, needs review: ${summary.needsHumanReview}\n`);
}

main();
