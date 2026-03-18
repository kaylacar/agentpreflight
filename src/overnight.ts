import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Preflight, ToolCall, ValidationResult } from "./types.js";

export interface OvernightStep {
  id?: string;
  command: string;
  tool?: string;
}

export interface OvernightChunk {
  id: string;
  objective: string;
  steps: OvernightStep[];
  gates?: string[];
  maxAttempts?: number;
  nextActions?: string[];
}

export interface OvernightPlan {
  name?: string;
  chunkTimeoutMinutes?: number;
  maxAttemptsPerChunk?: number;
  stopOnFailure?: boolean;
  gates?: string[];
  chunks: OvernightChunk[];
}

export interface OvernightChunkState {
  id: string;
  objective: string;
  status: "pending" | "running" | "completed" | "failed";
  attempts: number;
  startedAt?: string;
  endedAt?: string;
  lastError?: string;
}

export interface OvernightRunState {
  stateVersion: number;
  planName?: string;
  status: "running" | "completed" | "blocked";
  startedAt: string;
  updatedAt: string;
  currentChunkIndex: number;
  completedChunks: number;
  chunks: OvernightChunkState[];
  blockers: Array<{ chunkId: string; message: string }>;
}

export const OVERNIGHT_STATE_VERSION = 1;

export function resolveInitialOvernightState(
  storedState: OvernightRunState | undefined,
  reset: boolean
): { initialState: OvernightRunState | undefined; resetApplied: boolean } {
  if (!storedState) return { initialState: undefined, resetApplied: false };
  if (reset) return { initialState: undefined, resetApplied: true };
  if (storedState.stateVersion !== OVERNIGHT_STATE_VERSION) {
    return { initialState: undefined, resetApplied: true };
  }
  return { initialState: storedState, resetApplied: false };
}

export interface CommandRunResult {
  code: number;
  stdout?: string;
  stderr?: string;
}

export interface OvernightRunOptions {
  preflight: Preflight;
  executor: (command: string) => CommandRunResult;
  initialState?: OvernightRunState;
  onState?: (state: OvernightRunState) => void;
  handoffLogPath?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function initState(plan: OvernightPlan): OvernightRunState {
  const started = nowIso();
  return {
    stateVersion: OVERNIGHT_STATE_VERSION,
    planName: plan.name,
    status: "running",
    startedAt: started,
    updatedAt: started,
    currentChunkIndex: 0,
    completedChunks: 0,
    chunks: plan.chunks.map((c) => ({
      id: c.id,
      objective: c.objective,
      status: "pending",
      attempts: 0,
    })),
    blockers: [],
  };
}

function writeHandoff(
  handoffPath: string,
  chunk: OvernightChunk,
  status: "completed" | "failed",
  error?: string
): void {
  mkdirSync(dirname(handoffPath), { recursive: true });
  const next = chunk.nextActions && chunk.nextActions.length > 0 ? chunk.nextActions : ["Review latest logs and continue"];
  const blocker = status === "failed" ? error || "Unknown error" : "None";
  const body =
    `\n## ${new Date().toISOString()} - ${chunk.id}\n` +
    `- objective: ${chunk.objective}\n` +
    `- status: ${status}\n` +
    `- blocker: ${blocker}\n` +
    `- next_actions:\n` +
    next.map((n) => `  - ${n}`).join("\n") +
    "\n";
  appendFileSync(handoffPath, body, "utf8");
}

function firstFailure(results: ValidationResult[]): ValidationResult | undefined {
  return results.find((r) => r.status === "fail");
}

async function preflightAndRun(
  preflight: Preflight,
  executor: (command: string) => CommandRunResult,
  command: string,
  tool = "bash"
): Promise<{ ok: boolean; message?: string }> {
  const call: ToolCall = {
    tool,
    params: { command, cmd: command },
    source: "raw",
  };
  const { results, blocked, patchedCall } = await preflight.preflightCommand(call);
  const failed = firstFailure(results);
  if (blocked || failed) {
    return { ok: false, message: failed?.message || "Preflight blocked command" };
  }
  const finalCommand =
    (patchedCall && typeof patchedCall.params.command === "string" && patchedCall.params.command) || command;
  const runResult = executor(finalCommand);
  if (runResult.code !== 0) {
    const stderr = runResult.stderr?.trim();
    const stdout = runResult.stdout?.trim();
    const details = stderr || stdout || `exit code ${runResult.code}`;
    return { ok: false, message: `Command failed: ${finalCommand} -> ${details}` };
  }
  return { ok: true };
}

export async function runOvernightPlan(
  plan: OvernightPlan,
  options: OvernightRunOptions
): Promise<OvernightRunState> {
  const state = options.initialState ?? initState(plan);
  const stopOnFailure = plan.stopOnFailure ?? true;
  const globalMaxAttempts = plan.maxAttemptsPerChunk ?? 2;

  for (let i = state.currentChunkIndex; i < plan.chunks.length; i += 1) {
    const chunk = plan.chunks[i];
    const chunkState = state.chunks[i];
    if (chunkState.status === "completed") {
      state.currentChunkIndex = i + 1;
      continue;
    }

    chunkState.status = "running";
    chunkState.startedAt = chunkState.startedAt ?? nowIso();
    state.updatedAt = nowIso();
    options.onState?.(state);

    const maxAttempts = chunk.maxAttempts ?? globalMaxAttempts;
    let success = false;
    let failureMessage = "Unknown failure";

    while (chunkState.attempts < maxAttempts && !success) {
      chunkState.attempts += 1;
      state.updatedAt = nowIso();
      options.onState?.(state);
      let stepFailed = false;

      for (const step of chunk.steps) {
        const stepResult = await preflightAndRun(
          options.preflight,
          options.executor,
          step.command,
          step.tool ?? "bash"
        );
        if (!stepResult.ok) {
          failureMessage = `Chunk ${chunk.id} attempt ${chunkState.attempts}: ${stepResult.message}`;
          stepFailed = true;
          break;
        }
      }

      if (stepFailed) {
        continue;
      }

      const gates = chunk.gates ?? plan.gates ?? [];
      let gateFailed = false;
      for (const gateCommand of gates) {
        const gateResult = await preflightAndRun(options.preflight, options.executor, gateCommand, "bash");
        if (!gateResult.ok) {
          failureMessage = `Gate failed in ${chunk.id}: ${gateResult.message}`;
          gateFailed = true;
          break;
        }
      }

      if (!gateFailed) {
        success = true;
      }
    }

    if (success) {
      chunkState.status = "completed";
      chunkState.endedAt = nowIso();
      chunkState.lastError = undefined;
      state.completedChunks += 1;
      state.currentChunkIndex = i + 1;
      if (options.handoffLogPath) {
        writeHandoff(options.handoffLogPath, chunk, "completed");
      }
      state.updatedAt = nowIso();
      options.onState?.(state);
      continue;
    }

    chunkState.status = "failed";
    chunkState.lastError = failureMessage;
    chunkState.endedAt = nowIso();
    state.status = "blocked";
    state.blockers.push({ chunkId: chunk.id, message: failureMessage });
    state.updatedAt = nowIso();
    if (options.handoffLogPath) {
      writeHandoff(options.handoffLogPath, chunk, "failed", failureMessage);
    }
    options.onState?.(state);
    if (stopOnFailure) {
      return state;
    }
    state.currentChunkIndex = i + 1;
  }

  if (state.blockers.length === 0) {
    state.status = "completed";
  }
  state.updatedAt = nowIso();
  options.onState?.(state);
  return state;
}

export function persistRunState(path: string, state: OvernightRunState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2), "utf8");
}
