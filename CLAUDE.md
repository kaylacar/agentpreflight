# Preflight

Pre-flight validation SDK for AI tool calls.

## What this is

A general-purpose validation layer that sits between an AI's intent and execution. Intercepts tool calls, runs pre-flight checks, catches errors before they happen. Any AI coding tool can plug into it.

## Architecture

- `src/types.ts` — Core interfaces (ToolCall, ValidationResult, Rule)
- `src/engine.ts` — Rule matching + execution engine
- `src/reporter.ts` — Formats validation results
- `src/tools.ts` — Centralized tool name matching (ToolMatcher, ToolMappings, configurable per-instance)
- `src/manifest.ts` — Local environment manifest (repo name-to-path map, named paths)
- `src/rules/` — Rule modules:
  - `environment.ts` — OneDrive redirect, platform path separators, home dir resolution, repo path resolution
  - `filesystem.ts` — Parent dir exists, file exists for read, write permissions, symlink resolution, sensitive files
  - `git.ts` — Force push protection, upstream check, staging verification, branch protection, no-verify detection
  - `html-security.ts` — Detects innerHTML, eval(), document.write() in HTML/JS file writes
  - `json-validation.ts` — Validates JSON syntax in .json file writes
  - `naming.ts` — File naming convention enforcement, naming mistake detection
  - `network.ts` — Dangerous protocols, internal network access, secret in headers, HTTP vs HTTPS
  - `parallel.ts` — Cross-agent file conflict and git operation conflict detection
  - `scope.ts` — Path traversal detection, system directory write protection
  - `secrets.ts` — Secret/credential detection in file content and bash commands
  - `yaml-validation.ts` — Validates YAML syntax in .yml/.yaml file writes (tabs, unclosed quotes, duplicate keys)
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
