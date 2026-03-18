# OpenClaw Publish Checklist

1. Build + tests:
- `npm run typecheck`
- `npm run build`
- `npm test`
- `npm run test:contracts`

2. Install hook locally:
- `npm run setup:openclaw`
- restart OpenClaw gateway
- `openclaw hooks check`

3. Validate real blocking behavior:
- run an allowed command event (`git status --short`)
- run a blocked command event (`git push --force origin main`)

4. Generate one-week evidence:
- collect `.preflight/telemetry.jsonl`
- `npm run preflight:report`
- fill `docs/metrics-report-template.md`
- add 3 incidents using `docs/failure-mode-template.md`

5. Build listing package:
- `npm run openclaw:package`
- upload `.artifacts/openclaw-agentpreflight/`
