#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const home = os.homedir();
const claudeDir = path.join(home, ".claude");
const hooksDir = path.join(claudeDir, "hooks");
const hooksPkgPath = path.join(hooksDir, "package.json");
const hookScriptPath = path.join(hooksDir, "preflight.mjs");
const settingsPath = path.join(claudeDir, "settings.json");

const hookScript = `import { createPreflight, hasFailures, formatResults } from 'agentpreflight';
import { appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG = join(__dirname, 'preflight.log');
const log = (msg) => { try { appendFileSync(LOG, \`[\${new Date().toISOString()}] \${msg}\\n\`); } catch {} };

const pf = createPreflight({ rules: ['filesystem', 'secrets', 'environment', 'git', 'release'] });

let raw = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) raw += chunk;

let input;
try { input = JSON.parse(raw); } catch { process.exit(0); }

const tool = input.tool_name ?? '';
const params = input.tool_input ?? {};
log(\`tool=\${tool} params=\${JSON.stringify(params).slice(0, 120)}\`);

let call;
switch (tool) {
  case 'Read':  call = { tool: 'read_file',  params: { path: params.file_path } }; break;
  case 'Write': call = { tool: 'write_file', params: { path: params.file_path, content: params.file_text } }; break;
  case 'Edit':  call = { tool: 'edit_file',  params: { path: params.file_path, content: params.new_string } }; break;
  case 'Glob':  call = { tool: 'glob',       params: { pattern: params.pattern, path: params.path } }; break;
  case 'Bash':  call = { tool: 'bash',       params: { command: params.command } }; break;
  default: process.exit(0);
}

try {
  const results = await pf.validate(call);
  if (hasFailures(results)) {
    const msg = formatResults(results);
    log(\`BLOCKED \${tool}: \${msg}\`);
    process.stderr.write(\`agentpreflight blocked \${tool}:\\n\${msg}\\n\`);
    process.exit(2);
  }
  log(\`PASSED \${tool}\`);
} catch {}

process.exit(0);
`;

async function readJson(filePath, fallback) {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function toForwardSlashes(p) {
  return p.replace(/\\\\/g, "/");
}

function upsertPreToolUse(settings) {
  if (!settings.hooks || typeof settings.hooks !== "object") settings.hooks = {};
  if (!Array.isArray(settings.hooks.PreToolUse)) settings.hooks.PreToolUse = [];
  const command = `node ${toForwardSlashes(hookScriptPath)}`;
  const existing = settings.hooks.PreToolUse.find(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      entry.matcher === "Read|Write|Edit|Bash|Glob" &&
      Array.isArray(entry.hooks) &&
      entry.hooks.some((h) => h && h.type === "command" && h.command === command)
  );
  if (!existing) {
    settings.hooks.PreToolUse.push({
      matcher: "Read|Write|Edit|Bash|Glob",
      hooks: [{ type: "command", command, timeout: 10 }]
    });
  }
}

async function main() {
  await mkdir(hooksDir, { recursive: true });

  const hooksPkg = await readJson(hooksPkgPath, {
    name: "claude-hooks",
    version: "1.0.0",
    type: "module",
    private: true,
    dependencies: {}
  });
  hooksPkg.dependencies = hooksPkg.dependencies || {};
  if (!hooksPkg.dependencies.agentpreflight) {
    hooksPkg.dependencies.agentpreflight = "^0.1.0";
  }
  await writeFile(hooksPkgPath, `${JSON.stringify(hooksPkg, null, 2)}\n`, "utf8");

  await writeFile(hookScriptPath, hookScript, "utf8");

  const settings = await readJson(settingsPath, {});
  upsertPreToolUse(settings);
  await mkdir(claudeDir, { recursive: true });
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");

  process.stdout.write("agentpreflight Claude hook files written.\n");
  process.stdout.write(`1) cd ${hooksDir}\n`);
  process.stdout.write("2) pnpm install\n");
  process.stdout.write("3) restart Claude Code\n");
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
