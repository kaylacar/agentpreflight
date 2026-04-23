#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function copySkill(sourcePath, targetPath) {
  mkdirSync(path.dirname(targetPath), { recursive: true });
  const content = readFileSync(sourcePath, "utf8");
  const status = existsSync(targetPath)
    ? readFileSync(targetPath, "utf8") === content
      ? "unchanged"
      : "updated"
    : "created";
  writeFileSync(targetPath, content, "utf8");
  return status;
}

function upsertMarkedSection(filePath, sectionName, body) {
  const start = `<!-- ${sectionName}:start -->`;
  const end = `<!-- ${sectionName}:end -->`;
  const section = `${start}\n${body.trim()}\n${end}\n`;
  const existing = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  const pattern = new RegExp(`${start}[\\s\\S]*?${end}\\n?`, "m");
  const next = pattern.test(existing)
    ? existing.replace(pattern, section)
    : `${existing.trimEnd()}${existing.trim() ? "\n\n" : ""}${section}`;
  const status = existing === next ? "unchanged" : existsSync(filePath) ? "updated" : "created";
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, next, "utf8");
  return status;
}

function upsertFeatureFlag(configPath, key, value) {
  const existing = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  const lines = existing ? existing.split(/\r?\n/) : [];
  const flagLine = `${key} = ${value ? "true" : "false"}`;
  let inFeatures = false;
  let sawFeatures = false;
  let wroteFlag = false;
  const out = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\[[^\]]+\]$/.test(trimmed)) {
      if (inFeatures && !wroteFlag) {
        out.push(flagLine);
        wroteFlag = true;
      }
      inFeatures = trimmed === "[features]";
      sawFeatures = sawFeatures || inFeatures;
      out.push(line);
      continue;
    }

    if (inFeatures && new RegExp(`^${key}\\s*=`).test(trimmed)) {
      out.push(flagLine);
      wroteFlag = true;
      continue;
    }

    out.push(line);
  }

  if (inFeatures && !wroteFlag) {
    out.push(flagLine);
    wroteFlag = true;
  }

  if (!sawFeatures) {
    if (out.length > 0 && out[out.length - 1] !== "") out.push("");
    out.push("[features]", flagLine);
  }

  const next = `${out.join("\n").replace(/\s+$/u, "")}\n`;
  const status = existing === next ? "unchanged" : existsSync(configPath) ? "updated" : "created";
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(configPath, next, "utf8");
  return status;
}

function readJson(filePath, fallback) {
  if (!existsSync(filePath)) return fallback;
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonIfChanged(filePath, value) {
  const existing = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  const next = `${JSON.stringify(value, null, 2)}\n`;
  const status = existing === next ? "unchanged" : existsSync(filePath) ? "updated" : "created";
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, next, "utf8");
  return status;
}

function upsertCodexPreToolHook(hooksPath, hookScriptPath) {
  const hooks = readJson(hooksPath, {});
  if (!hooks.PreToolUse || !Array.isArray(hooks.PreToolUse)) hooks.PreToolUse = [];

  const command = `node ${hookScriptPath.replace(/\\/g, "/")}`;
  const entry = {
    matcher: "Bash",
    statusMessage: "Running agentpreflight",
    hooks: [{ type: "command", command, timeout: 10 }],
  };
  const existingIndex = hooks.PreToolUse.findIndex(
    (item) =>
      item &&
      typeof item === "object" &&
      Array.isArray(item.hooks) &&
      item.hooks.some((hook) => hook && typeof hook.command === "string" && hook.command.includes("codex-pre-tool-hook.mjs"))
  );

  if (existingIndex >= 0) hooks.PreToolUse[existingIndex] = entry;
  else hooks.PreToolUse.push(entry);

  return writeJsonIfChanged(hooksPath, hooks);
}

function buildCodexGuardrail(repoRootPath) {
  const root = repoRootPath.replace(/\\/g, "/");
  return `## agentpreflight

Route Codex tool actions through agentpreflight when working in this workspace.

- Codex PreToolUse hook: installed at \`${root}/setup/codex-pre-tool-hook.mjs\` and configured in \`~/.codex/hooks.json\` for Bash.
- Shell commands: run through \`node ${root}/setup/preflight-exec.mjs --cwd <cwd> --command "<command>"\`.
- Codex-shaped tool calls: validate with \`node ${root}/setup/codex-preflight.mjs --cwd <cwd> --tool <recipient_name> --params-json '<json>'\`, or pipe a Codex tool-call JSON object into that script.
- File writes/edits: validate the planned Codex call with \`setup/codex-preflight.mjs\` before applying the edit.
- Block execution when agentpreflight exits nonzero or reports any \`fail\`.
- Verify tracking by checking \`${root}/.preflight/telemetry.jsonl\` or the current repo's \`.preflight/telemetry.jsonl\`.

Current Codex PreToolUse support only intercepts Bash, and Codex documentation says hooks are temporarily disabled on Windows. Until the runtime invokes hooks on this machine, use the CLI/SDK path above so validation and telemetry are recorded.`;
}

export function setupCodex(options = {}) {
  const homeDir = options.homeDir || os.homedir();
  const codexRoot = path.join(homeDir, ".codex");
  const skillRoot = path.join(homeDir, ".codex", "skills");
  const codexMemoriesRoot = path.join(homeDir, ".codex", "memories");
  const workspaceAgentsPath = path.join(homeDir, "AGENTS.md");
  const guardrailPath = path.join(codexMemoriesRoot, "agentpreflight-codex-guardrail.md");
  const codexConfigPath = path.join(codexRoot, "config.toml");
  const codexHooksPath = path.join(codexRoot, "hooks.json");
  const codexPreToolHookPath = path.join(repoRoot, "setup", "codex-pre-tool-hook.mjs");
  const targets = [
    { name: "agentpreflight", source: path.join(repoRoot, "skills", "agentpreflight", "SKILL.md") },
    { name: "agent-preflight", source: path.join(repoRoot, "skills", "agent-preflight", "SKILL.md") },
  ];

  const results = [];
  for (const target of targets) {
    const dest = path.join(skillRoot, target.name, "SKILL.md");
    results.push({ name: target.name, path: dest, status: copySkill(target.source, dest) });
  }

  const guardrail = buildCodexGuardrail(repoRoot);
  const instructionResults = [
    {
      name: "codex-memory",
      path: guardrailPath,
      status: upsertMarkedSection(guardrailPath, "agentpreflight-codex", guardrail),
    },
    {
      name: "workspace-agents",
      path: workspaceAgentsPath,
      status: upsertMarkedSection(workspaceAgentsPath, "agentpreflight-codex", guardrail),
    },
  ];
  const hookResults = [
    {
      name: "codex-hooks-json",
      path: codexHooksPath,
      status: upsertCodexPreToolHook(codexHooksPath, codexPreToolHookPath),
    },
    {
      name: "codex-hooks-feature",
      path: codexConfigPath,
      status: upsertFeatureFlag(codexConfigPath, "codex_hooks", true),
    },
  ];

  return {
    skillRoot,
    guardrailPath,
    workspaceAgentsPath,
    codexHooksPath,
    codexConfigPath,
    results,
    instructionResults,
    hookResults,
  };
}

export function main() {
  const result = setupCodex();
  process.stdout.write("Codex agentpreflight skill setup complete.\n");
  for (const entry of result.results) {
    process.stdout.write(`${entry.name}: ${entry.path} (${entry.status})\n`);
  }
  for (const entry of result.instructionResults) {
    process.stdout.write(`${entry.name}: ${entry.path} (${entry.status})\n`);
  }
  for (const entry of result.hookResults) {
    process.stdout.write(`${entry.name}: ${entry.path} (${entry.status})\n`);
  }
  process.stdout.write("Restart Codex to reload installed skills.\n");
}

const isDirectRun =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectRun) {
  main();
}
