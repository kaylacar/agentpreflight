# Mandatory Gate Demo

Small demo that enforces `preflight:exec` as a mandatory shell gate.

## Setup

From the repo root:

```bash
npm run build
```

## Allowed Command

```bash
npm run preflight:exec -- --command "git status --short"
```

## Blocked Command

```bash
npm run preflight:exec -- --command "git push --force origin main"
```

Expected: blocked by `force-push-protection`.

## One-Week Telemetry Collection

Set telemetry in your integration to `.preflight/telemetry.jsonl`, then run:

```bash
node setup/analyze-telemetry.mjs --file .preflight/telemetry.jsonl --output .preflight/metrics-report.md
```

Use `docs/metrics-report-template.md` and `docs/failure-mode-template.md` for publish evidence.
