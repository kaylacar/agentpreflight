import { spawnSync } from "node:child_process";
import type { CommandRunResult } from "./overnight.js";

export interface NormalizedCommand {
  file: string;
  args: string[];
}

export function normalizeCommand(platform: NodeJS.Platform, command: string): NormalizedCommand {
  if (platform === "win32") {
    return {
      file: "powershell.exe",
      args: ["-NoProfile", "-NonInteractive", "-Command", command],
    };
  }
  return {
    file: "sh",
    args: ["-lc", command],
  };
}

export function createPlatformExecutor(
  options: {
    platform?: NodeJS.Platform;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    stdout?: (text: string) => void;
    stderr?: (text: string) => void;
  } = {}
): (command: string) => CommandRunResult {
  const platform = options.platform ?? process.platform;
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;

  return (command: string): CommandRunResult => {
    const normalized = normalizeCommand(platform, command);
    const child = spawnSync(normalized.file, normalized.args, {
      encoding: "utf8",
      cwd,
      env,
      stdio: ["inherit", "pipe", "pipe"],
    });

    const stdout = child.stdout || "";
    const stderr = child.stderr || "";
    if (stdout) (options.stdout ?? process.stdout.write.bind(process.stdout))(stdout);
    if (stderr) (options.stderr ?? process.stderr.write.bind(process.stderr))(stderr);

    if (child.error) {
      return {
        code: 1,
        stderr: child.error.message,
      };
    }

    return {
      code: typeof child.status === "number" ? child.status : 1,
      stdout,
      stderr,
    };
  };
}
