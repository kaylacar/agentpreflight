#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

function sha256(filePath) {
  const data = readFileSync(filePath);
  return crypto.createHash("sha256").update(data).digest("hex");
}

function main() {
  const root = process.cwd();
  const distPath = path.join(root, "dist", "index.js");
  if (!existsSync(distPath)) {
    process.stderr.write("dist/index.js missing. Run `npm run build` first.\n");
    process.exit(2);
  }

  const outDir = path.join(root, ".artifacts", "openclaw-agentpreflight");
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const hooksSrc = path.join(root, "setup", "openclaw-hooks");
  if (!existsSync(hooksSrc)) {
    process.stderr.write("setup/openclaw-hooks not found. Run `npm run setup:openclaw` first.\n");
    process.exit(2);
  }

  cpSync(hooksSrc, path.join(outDir, "openclaw-hooks"), { recursive: true });
  cpSync(path.join(root, "templates", "openclaw.app.manifest.json"), path.join(outDir, "openclaw.app.manifest.json"));
  cpSync(path.join(root, "examples", "openclaw-demo", "README.md"), path.join(outDir, "README.md"));

  const checksums = [
    ["openclaw.app.manifest.json", sha256(path.join(outDir, "openclaw.app.manifest.json"))],
    [
      "openclaw-hooks/agentpreflight/HOOK.md",
      sha256(path.join(outDir, "openclaw-hooks", "agentpreflight", "HOOK.md")),
    ],
    [
      "openclaw-hooks/agentpreflight/handler.mjs",
      sha256(path.join(outDir, "openclaw-hooks", "agentpreflight", "handler.mjs")),
    ],
  ];

  writeFileSync(
    path.join(outDir, "SHA256SUMS"),
    `${checksums.map(([file, hash]) => `${hash}  ${file}`).join("\n")}\n`,
    "utf8"
  );

  process.stdout.write(`OpenClaw app package prepared at: ${outDir}\n`);
  process.stdout.write("Submit this directory contents to your OpenClaw listing flow.\n");
}

main();
