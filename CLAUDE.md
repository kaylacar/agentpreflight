# Preflight

Pre-flight validation SDK for AI tool calls.

## agentpreflight trigger contract

If the user says `agentpreflight` or `preflight`, run preflight validation before executing tool calls.

Required behavior:
- Block execution when any rule returns `fail`.
- Report warnings and use safe `suggestion` values when status is `warn`.
- Always report `Preflight: pass|warn|fail`, rule findings, and blocked/allowed decision.

Enforcement requirement:
- Do not execute direct `Bash/Write/Edit` actions until preflight has run for that call.
- Treat preflight as mandatory gate, not advisory.

## What this is

A general-purpose validation layer that sits between an AI's intent and execution. Intercepts tool calls, runs pre-flight checks, catches errors before they happen. Any AI coding tool can plug into it.

## Architecture

- `src/types.ts` — Core interfaces (ToolCall, ValidationResult, Rule)
- `src/engine.ts` — Rule matching + execution engine
- `src/reporter.ts` — Formats validation results
- `src/rules/` — Rule modules:
  - `environment.ts` — OneDrive redirect, platform path separators, home dir resolution
  - `filesystem.ts` — Parent dir exists, file exists for read, write permissions, sensitive files
  - `git.ts` — Force push protection, upstream check, staging verification, branch protection
  - `naming.ts` — File naming convention enforcement, naming mistake detection
  - `parallel.ts` — Cross-agent file conflict and git operation conflict detection
- `src/index.ts` — Public API (createPreflight, validate)

## Commands

- `pnpm test` — run all tests
- `pnpm build` — build with tsup
- `pnpm typecheck` — type check without emitting

## Conventions

- TypeScript, ESM, vitest, tsup
- Zero external dependencies for core engine (only node builtins)
- Rules are pluggable — users can add custom rules
- Tool names are case-insensitive in rule matching
- npm package: agentpreflight
