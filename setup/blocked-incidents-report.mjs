#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const out = {
    file: ".preflight/telemetry.jsonl",
    output: ".preflight/blocked-incidents.md",
    limit: 20,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--file") out.file = argv[++i] || out.file;
    else if (arg === "--output") out.output = argv[++i] || out.output;
    else if (arg === "--limit") out.limit = Number(argv[++i] || out.limit);
  }
  return out;
}

function loadRows(filePath) {
  if (!existsSync(filePath)) throw new Error(`Telemetry file not found: ${filePath}`);
  return readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function clip(value, size = 220) {
  const text = String(value || "");
  return text.length > size ? `${text.slice(0, size)}...` : text;
}

function toMarkdown(sourcePath, blockedRows) {
  const lines = [];
  lines.push("# Blocked Incidents Report");
  lines.push("");
  lines.push(`- source: \`${sourcePath}\``);
  lines.push(`- generated_at: \`${new Date().toISOString()}\``);
  lines.push(`- incidents: **${blockedRows.length}**`);
  lines.push("");
  lines.push("## Incidents");
  lines.push("");
  if (blockedRows.length === 0) {
    lines.push("- none");
    return `${lines.join("\n")}\n`;
  }
  for (const row of blockedRows) {
    const findings = Array.isArray(row.findings) ? row.findings.filter((f) => f.status === "fail") : [];
    const primary = findings[0] || {};
    lines.push(`### ${row.ts || "unknown-time"} | ${row.tool || "tool"} | ${primary.rule || "unknown-rule"}`);
    lines.push("");
    lines.push(`- command: \`${clip(row.commandPreview || "", 180)}\``);
    lines.push(`- reason: ${clip(primary.message || "blocked by policy", 220)}`);
    lines.push(`- source: ${row.source || "raw"}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const rows = loadRows(args.file);
  const blockedRows = rows
    .filter((row) => row && row.status === "blocked")
    .sort((a, b) => String(b.ts || "").localeCompare(String(a.ts || "")))
    .slice(0, Math.max(1, args.limit));
  const markdown = toMarkdown(path.resolve(args.file), blockedRows);
  writeFileSync(args.output, markdown, "utf8");
  process.stdout.write(`Wrote blocked incident report: ${args.output}\n`);
}

main();
