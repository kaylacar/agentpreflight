---
name: agentpreflight
description: Validate planned tool calls with the local `agentpreflight` package before execution. Use when the user asks for preflight checks, safe command validation, or release-gate enforcement.
---

# Agent Preflight

Use this skill to run pre-execution validation with `agentpreflight`.

## Trigger

Use when the user says:
- `$agentpreflight`
- `$agent-preflight`
- `agent preflight`
- `preflight this`
- `validate before execute`

## What to do

1. Build a preflight input object for the intended tool call:
- `tool` (for example `bash`, `write`, `edit`)
- `params` (for example `command`, `path`, `content`)
2. Run validation with `createPreflight().validate(...)`.
3. Block execution if any rule returns `status: fail`.
4. If only warnings exist, show warnings and apply `suggestion` values when safe.
5. Proceed only after reporting the preflight result.

## Codex tracking

When the user asks for Codex tracking or all actions to be tracked:
- Prefer the installed Codex `PreToolUse` hook for Bash commands when the runtime supports hooks.
- Run shell commands through `node <agentpreflight-repo>/setup/preflight-exec.mjs --cwd <cwd> --command "<command>"`.
- Validate Codex-shaped tool calls through `node <agentpreflight-repo>/setup/codex-preflight.mjs`.
- For `functions.apply_patch` or file edits, validate the planned Codex call before applying the edit.
- After execution, read `.preflight/telemetry.jsonl` and report the newest matching entry.

## Usage pattern

```ts
import { createPreflight, hasFailures } from 'agentpreflight';

const pf = createPreflight();
const results = await pf.validate({
  tool: 'bash',
  params: { command: 'git push origin master' }
});

if (hasFailures(results)) {
  // stop and report
}
```

## Output contract

Always report:
- `Preflight: pass|warn|fail`
- Rule findings (rule + message)
- Suggested correction if present
- Whether execution is blocked or allowed
