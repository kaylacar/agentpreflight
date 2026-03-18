# OpenClaw 5-Minute Setup

From repo root:

```bash
npm run build
npm run setup:openclaw
```

Then restart your OpenClaw gateway and run:

```bash
openclaw hooks check
```

Expected: `agentpreflight` hook is discovered/enabled from `setup/openclaw-hooks`.

Smoke test payload:

```json
{
  "tool_name": "bash",
  "arguments": {
    "cmd": "git push --force origin main"
  }
}
```

This should be blocked by preflight.
