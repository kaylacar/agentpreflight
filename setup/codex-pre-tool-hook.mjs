#!/usr/bin/env node
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      raw += chunk;
    });
    process.stdin.on("end", () => resolve(raw.trim()));
    process.stdin.on("error", reject);
  });
}

export function buildToolCallFromHookPayload(payload) {
  const input = asRecord(payload);
  const toolInput = asRecord(input.tool_input);
  return {
    tool: String(input.tool_name || "Bash").toLowerCase() === "bash" ? "bash" : String(input.tool_name || ""),
    params: {
      ...toolInput,
      command: toolInput.command ?? toolInput.cmd,
      codexHookEvent: input.hook_event_name,
      codexToolUseId: input.tool_use_id,
      codexTurnId: input.turn_id,
    },
    agentId: typeof input.session_id === "string" ? input.session_id : undefined,
    source: "codex",
  };
}

export function blockOutput(reason) {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}

export function warningOutput(message) {
  return {
    systemMessage: message,
  };
}

function resolveSdkDistPath() {
  return path.resolve(__dirname, "..", "dist", "index.js");
}

async function loadSdk() {
  const dist = resolveSdkDistPath();
  if (!existsSync(dist)) {
    throw new Error(`dist/index.js missing: ${dist}. Run npm run build first.`);
  }
  return import(pathToFileURL(dist).href);
}

function hookCwd(payload) {
  const cwd = asRecord(payload).cwd;
  return typeof cwd === "string" && cwd ? cwd : process.cwd();
}

function telemetryPathFor(cwd) {
  return process.env.AGENTPREFLIGHT_TELEMETRY || path.join(cwd, ".preflight", "telemetry.jsonl");
}

async function main() {
  const raw = await readStdin();
  if (!raw) return;

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return;
  }

  const call = buildToolCallFromHookPayload(payload);
  if (call.tool !== "bash" || typeof call.params.command !== "string" || !call.params.command) {
    return;
  }

  const cwd = hookCwd(payload);
  const { createPreflight, formatResults, hasFailures, hasWarnings } = await loadSdk();
  const pf = createPreflight({
    cwd,
    telemetryPath: telemetryPathFor(cwd),
    telemetryRequired: true,
  });

  try {
    const results = await pf.validateWithPolicy(call);
    const formatted = formatResults(results);

    if (hasFailures(results)) {
      process.stdout.write(`${JSON.stringify(blockOutput(formatted))}\n`);
      return;
    }

    if (hasWarnings(results)) {
      process.stdout.write(`${JSON.stringify(warningOutput(`agentpreflight warning:\n${formatted}`))}\n`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown preflight hook failure";
    process.stdout.write(`${JSON.stringify(blockOutput(`agentpreflight validation failed: ${message}`))}\n`);
  }
}

const isDirectRun =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectRun) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(`${JSON.stringify(blockOutput(`agentpreflight validation failed: ${message}`))}\n`);
  });
}
