#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";

function resolveOpenClawHome() {
  return process.env.OPENCLAW_HOME || path.join(os.homedir(), ".openclaw");
}

function resolveConfigPath(openclawHome) {
  if (process.env.OPENCLAW_CONFIG_PATH) return process.env.OPENCLAW_CONFIG_PATH;
  return path.join(openclawHome, "openclaw.json");
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function upsertConfig(configPath, hookBaseDir) {
  const config = readJson(configPath, {});
  if (!config.hooks || typeof config.hooks !== "object") config.hooks = {};
  if (!config.hooks.internal || typeof config.hooks.internal !== "object") config.hooks.internal = {};
  config.hooks.internal.enabled = true;
  if (!config.hooks.internal.load || typeof config.hooks.internal.load !== "object") {
    config.hooks.internal.load = {};
  }
  if (!Array.isArray(config.hooks.internal.load.extraDirs)) {
    config.hooks.internal.load.extraDirs = [];
  }
  if (!config.hooks.internal.load.extraDirs.includes(hookBaseDir)) {
    config.hooks.internal.load.extraDirs.push(hookBaseDir);
  }
  if (!config.hooks.internal.entries || typeof config.hooks.internal.entries !== "object") {
    config.hooks.internal.entries = {};
  }
  if (!config.hooks.internal.entries.agentpreflight) {
    config.hooks.internal.entries.agentpreflight = {};
  }
  config.hooks.internal.entries.agentpreflight.enabled = true;
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export function setupOpenClaw(options = {}) {
  const root = options.cwd || process.cwd();
  const openclawHome = options.openclawHome || resolveOpenClawHome();
  const configPath = options.configPath || resolveConfigPath(openclawHome);
  const localFallbackConfigPath = path.join(root, ".openclaw", "openclaw.json");
  const hookBaseDir = path.join(root, "setup", "openclaw-hooks");
  const hookDir = path.join(hookBaseDir, "agentpreflight");
  const hookDocPath = path.join(hookDir, "HOOK.md");
  const handlerPath = path.join(hookDir, "handler.mjs");

  mkdirSync(hookDir, { recursive: true });
  mkdirSync(path.dirname(configPath), { recursive: true });

  const hookDoc = `---
name: agentpreflight
description: Validate command events with agentpreflight before execution.
metadata:
  openclaw:
    emoji: "guard"
    events: ["command"]
    export: "default"
---

# agentpreflight OpenClaw Hook

Blocks risky command payloads using local policy.
`;

  const handler = `import { createPreflight, hasFailures, formatResults, adaptToolCall } from "../../../dist/index.js";

const pf = createPreflight({
  policyMode: "enforce",
  telemetryPath: ".preflight/telemetry.jsonl",
});

export default async function handler(event) {
  const payload = event?.payload || event || {};
  const call = adaptToolCall(payload, "openclaw");
  const results = await pf.validateWithPolicy(call);
  if (hasFailures(results)) {
    return {
      ok: false,
      blocked: true,
      message: formatResults(results),
    };
  }
  return { ok: true, blocked: false };
}
`;

  writeFileSync(hookDocPath, hookDoc, "utf8");
  writeFileSync(handlerPath, handler, "utf8");
  let effectiveConfigPath = configPath;
  try {
    upsertConfig(configPath, hookBaseDir);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EPERM") {
      mkdirSync(path.dirname(localFallbackConfigPath), { recursive: true });
      upsertConfig(localFallbackConfigPath, hookBaseDir);
      effectiveConfigPath = localFallbackConfigPath;
    } else {
      throw error;
    }
  }

  return {
    root,
    configPath: effectiveConfigPath,
    hookBaseDir,
    hookDir,
    hookDocPath,
    handlerPath,
    distMissing: !existsSync(path.join(root, "dist", "index.js")),
  };
}

function main() {
  const result = setupOpenClaw();
  process.stdout.write("OpenClaw agentpreflight setup complete.\n");
  process.stdout.write(`Config: ${result.configPath}\n`);
  process.stdout.write(`Hook dir: ${result.hookDir}\n`);
  process.stdout.write("Next: restart OpenClaw gateway, then run `openclaw hooks check`.\n");
  if (result.distMissing) {
    process.stdout.write("Build required: run `npm run build` before starting OpenClaw.\n");
  }
}

const isDirectRun =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectRun) {
  main();
}
