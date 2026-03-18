#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const npmCli = resolve(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");

function runNpm(args) {
  const result = spawnSync(process.execPath, [npmCli, ...args], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) {
    throw result.error;
  }
  if (typeof result.status !== "number" || result.status !== 0) {
    throw new Error(`Step failed: npm ${args.join(" ")}`);
  }
}

runNpm(["run", "typecheck"]);
runNpm(["run", "build"]);
runNpm(["test"]);
runNpm(["run", "test:contracts"]);

process.stdout.write("merge gates passed\n");
