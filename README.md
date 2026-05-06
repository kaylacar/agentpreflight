# agentpreflight

A pre-execution gate for AI tool calls. It sits between an agent's intent and what actually runs — intercepts each tool call, validates it against the real state of the system at the moment of the call, and blocks the operations that shouldn't happen.

It is not a logger and not a post-hoc audit. The rules fire before the call is dispatched, so a bad `git push --force origin main`, a `Write` to a nonexistent parent directory, or a `git commit` with an empty stage never leaves the agent.

Thirteen rule sets ship by default — six security (filesystem, git, secrets, environment, network, parallel) and seven workflow (naming, scope, editorial, session, time-estimation, prewrite, release). Rules are small, composable functions; adding your own takes a few lines. The core engine has zero runtime dependencies. Adapters cover Claude Code, Cursor, Codex, and Openclaw.

Canonical repo: `https://github.com/kaylacar/agentpreflight`
npm: `agentpreflight`

---

## What it is

A pre-execution gate that sits between an AI agent's intent and what it actually runs. Intercepts each tool call, validates it against the real state of the system, blocks the unsafe ones, and rewrites the recoverable ones.

It validates **two lanes with one engine**:

- **Security and correctness** — force-pushes to `main`, secret commits, writes to nonexistent paths, OneDrive redirects, dangerous shell commands, cross-agent file conflicts.
- **Personal and workflow discipline** — naming conventions, scope creep, session checkpoints, editorial style, time-estimation calibration, completion-claim evidence.

| | Runtime deps | Layer | Workflow / personal rules shipped? |
|---|---|---|---|
| **agentpreflight** | **0** (node builtins) | pre-execution tool gate | yes — 7 rule sets |
| Guardrails AI | 27 | output validator | no |
| NeMo Guardrails | 21 | dialog + I/O moderation | no |
| Microsoft Agent Governance Toolkit | heavy multi-language stack | runtime action governance | no |

agentpreflight is not a substitute for an agent runtime governance toolkit. It sits *upstream* of the tool call, in process, with one dependency-free npm install.

---

## Real blocks in production

```
agentpreflight blocked Bash:
[FAIL] staging-verification: Nothing is staged for commit
       → Use git add to stage files first
```
Claude ran `git add README.md && git commit -m "..."` as one chained command. The commit ran before staging completed. Blocked. Claude split it into two calls.

```
agentpreflight blocked Read:
[FAIL] file-exists-for-read: File does not exist: ./config/settings.json
```
Claude tried to read a config file before it was created. Blocked before the round-trip.

```
agentpreflight blocked Bash:
[FAIL] force-push-protection: git push --force to main
       → Use --force-with-lease, or push to a feature branch first
```

Each blocked call saves roughly 800 tokens — the failed tool output, the error message, and the retry.

---

## Install

```bash
npm install agentpreflight
# or: pnpm add agentpreflight  /  yarn add agentpreflight
```

Requires Node 18+. ESM only. Zero runtime dependencies.

---

## 30-second usage

```ts
import { createPreflight, hasFailures } from 'agentpreflight';

const pf = createPreflight();

const results = await pf.validate({
  tool: 'bash',
  params: { command: 'git push --force origin main' },
});

if (hasFailures(results)) {
  // block execution — the agent gets a clear reason why
}
```

Defaults:
- Telemetry → `.preflight/telemetry.jsonl`
- `telemetryRequired: true` (fail-closed if telemetry can't be written)
- Stack auto-detection on when `rules` is not explicitly set

---

## Rule sets at a glance

13 rule sets ship in the package. All load by default. Load a subset:

```ts
const pf = createPreflight({ rules: ['filesystem', 'git', 'secrets'] });
```

### Security and correctness

| Rule set | Catches |
|---|---|
| `filesystem` | Writes to nonexistent dirs, missing reads, sensitive-file writes |
| `git` | Force-pushes to main, unstaged commits, `--no-verify`, branch protection |
| `secrets` | API keys, tokens, private keys in content or shell commands |
| `environment` | OneDrive redirects, wrong path separators, tilde paths, `/dev/null` on Windows |
| `network` | HTTP (not HTTPS) URLs in commands, localhost URLs that look prod-bound |
| `parallel` | Cross-agent file conflicts, simultaneous git operations |

### Personal and workflow discipline

| Rule set | Enforces |
|---|---|
| `naming` | No spaces in filenames, casing rules, extension/content match |
| `scope` | No writes outside cwd, dangerous-command detection |
| `editorial` | Locked phrases, banned words, required terms (state-driven) |
| `session` | Session checkpoints before destructive commands |
| `time-estimation` | Calibration drift on `bestCase`/`p90`/`actual` minutes |
| `prewrite` | Pre-write external gates: lint, typecheck, type-hint match |
| `release` | Completion claims must include an evidence table |

Detailed rule tables: [Detailed rules](#detailed-rules).

---

## Personal rules — keep project truth outside model memory

Instead of hoping the next agent remembers a `CLAUDE.md` note or a thread detail, store project state locally and enforce it before execution or output.

One-command editorial scaffold:

```bash
npx agentpreflight-setup-editorial --edit
```

Creates `.preflight/editorial-state.json` and `.preflight/editorial.preflight.policy.json`, updates them on later runs without overwriting your existing values, backs up malformed scaffold files before repairing them, and opens the state file for editing.

Add state directly through agentpreflight instead of keeping ad hoc memory notes:

```bash
npx agentpreflight-setup-editorial \
  --locked "no ecosystem section" \
  --banned "How It Works" \
  --required "control"
```

Policy packs can also point at a generic project state file and explicitly toggle response/output gates:

```json
{
  "responseChecks": { "enabled": true },
  "projectState": { "stateFile": ".preflight/project-state.json" }
}
```

---

## Environment manifest

The most common agent friction point: not knowing where things are on the machine.

Create `~/.preflight-env.json` once:

```json
{
  "repos": {
    "my-repo": "/absolute/path/to/my-repo",
    "another-repo": "/absolute/path/to/another-repo"
  },
  "paths": {
    "desktop": "/Users/you/Desktop",
    "github": "/Users/you/Documents/GitHub"
  }
}
```

Then at session start:

```ts
import { getEnv, resolveRepo, resolvePath } from 'agentpreflight';

const env = await getEnv(); // null if file doesn't exist — not an error

if (env) {
  resolveRepo(env, 'my-repo');     // → '/absolute/path/to/my-repo'
  resolvePath(env, 'desktop');     // → '/Users/you/Desktop'
  resolveRepo(env, 'unknown');     // → null
}
```

The `repo-path-resolution` rule uses the manifest automatically. If an agent passes a relative repo name as a path, it gets a `warn` result with the resolved absolute path in `suggestion`.

On Windows with OneDrive, agentpreflight already knows that `Desktop` and `Documents` are likely redirected. The `onedrive-redirect` rule catches this automatically — no manifest needed for that.

---

## Claude Code global hook

Install once. Validates every tool call Claude makes, across every project, permanently.

**1. Set up the hook directory**

```bash
mkdir -p ~/.claude/hooks && cd ~/.claude/hooks
```

Create `package.json`:

```json
{
  "name": "claude-hooks",
  "version": "1.0.0",
  "type": "module",
  "private": true,
  "dependencies": { "agentpreflight": "^0.1.1" }
}
```

```bash
pnpm install
```

**2. Create `~/.claude/hooks/preflight.mjs`**

```js
import { createPreflight, hasFailures, formatResults } from 'agentpreflight';
import { appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG = join(__dirname, 'preflight.log');
const log = (msg) => { try { appendFileSync(LOG, `[${new Date().toISOString()}] ${msg}\n`); } catch {} };

const pf = createPreflight({ rules: ['filesystem', 'secrets', 'environment', 'git'] });

let raw = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) raw += chunk;

let input;
try { input = JSON.parse(raw); } catch { process.exit(0); }

const tool = input.tool_name ?? '';
const params = input.tool_input ?? {};
log(`tool=${tool} params=${JSON.stringify(params).slice(0, 120)}`);

let call;
switch (tool) {
  case 'Read':  call = { tool: 'read_file',  params: { path: params.file_path } }; break;
  case 'Write': call = { tool: 'write_file', params: { path: params.file_path, content: params.file_text } }; break;
  case 'Edit':  call = { tool: 'edit_file',  params: { path: params.file_path, content: params.new_string } }; break;
  case 'Glob':  call = { tool: 'glob',       params: { pattern: params.pattern, path: params.path } }; break;
  case 'Bash':  call = { tool: 'bash',       params: { command: params.command } }; break;
  default: process.exit(0);
}

try {
  const results = await pf.validate(call);
  if (hasFailures(results)) {
    const msg = formatResults(results);
    log(`BLOCKED ${tool}: ${msg}`);
    process.stderr.write(`agentpreflight blocked ${tool}:\n${msg}\n`);
    process.exit(2);
  }
  log(`PASSED ${tool}`);
} catch { /* validation error — let through */ }

process.exit(0);
```

**3. Register in `~/.claude/settings.json`**

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Read|Write|Edit|Bash|Glob",
        "hooks": [{ "type": "command", "command": "node C:/Users/YOU/.claude/hooks/preflight.mjs", "timeout": 10 }]
      }
    ]
  }
}
```

Use forward slashes in the path even on Windows. Start a new Claude Code session — hooks load at startup.

**Track it as an experiment** — save as `~/.claude/hooks/stats.mjs`:

```js
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const lines = readFileSync(join(__dirname, 'preflight.log'), 'utf8').trim().split('\n').filter(Boolean);

let total = 0, blocked = 0, passed = 0;
const blocksByRule = {}, passByTool = {};

for (const line of lines) {
  const p = line.match(/PASSED (\w+)/);
  const b = line.match(/BLOCKED (\w+)/);
  const f = line.match(/\[FAIL\] ([^:]+)/);
  if (p) { total++; passed++; passByTool[p[1]] = (passByTool[p[1]] ?? 0) + 1; }
  else if (b) { total++; blocked++; }
  if (f) { const r = f[1].trim(); blocksByRule[r] = (blocksByRule[r] ?? 0) + 1; }
}

console.log(`Total: ${total} | Passed: ${passed} | Blocked: ${blocked}`);
console.log(`Estimated tokens saved: ~${(blocked * 800).toLocaleString()}`);
if (Object.keys(blocksByRule).length) {
  console.log('\nBlocked by rule:');
  for (const [r, n] of Object.entries(blocksByRule).sort((a,b) => b[1]-a[1]))
    console.log(`  ${r}: ${n}`);
}
```

```bash
node ~/.claude/hooks/stats.mjs
```

---

## Codex skill

Install from this repo:

```bash
python ~/.codex/skills/.system/skill-installer/scripts/install-skill-from-github.py \
  --repo kaylacar/agentpreflight --path skills/agentpreflight
```

Then restart Codex and use:

```
$agentpreflight ...
```

---

## OpenClaw

```bash
npm install
npm run build
npm run setup:openclaw
npm run openclaw:package
```

Restart the OpenClaw gateway, then run `openclaw hooks check`. Listing prep: see `docs/openclaw-publish-checklist.md`.

OpenClaw adapter usage from code:

```ts
import { validateAdapted } from 'agentpreflight';

const results = await validateAdapted(openclawPayload, 'openclaw', {
  policyMode: 'enforce',
});
```

---

## GitHub Action

Use agentpreflight as a CI gate on pull requests. The action installs the npm package and replays a JSON file of planned tool calls; it exits non-zero if any rule fails.

```yaml
# .github/workflows/preflight.yml
name: Preflight
on:
  pull_request:
    paths: ['.preflight/tool-calls.json']

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: kaylacar/agentpreflight@v0.1.3
        with:
          tool-calls-file: '.preflight/tool-calls.json'
```

Inputs:
- `tool-calls-file` (required): path to the JSON array of tool calls
- `version` (optional, default `latest`): pin a specific agentpreflight version
- `node-version` (optional, default `20`): override Node.js version

A reference example workflow is at `.github/workflows/example-preflight.yml`.

---

## Mandatory enforcement mode

If you want agentpreflight to be a real control plane (not advisory), enforce one of these:

1. **Claude Code `PreToolUse` hook** (above) — global and automatic.
2. **Wrapper execution** for shell commands:

```bash
npm run preflight:exec -- --command "git push origin master"
```

Reliable wrapper usage on Windows (quoting/cwd stable):

```bash
npm run preflight:exec -- --cwd "C:\path\to\repo" --arg npm.cmd --arg run --arg verify
```

This wrapper blocks execution on `fail` and only runs the command if preflight passes.

3. **Unattended overnight runs** with chunking, retries, gates, and state persistence:

```bash
cp templates/overnight.plan.json .preflight/overnight.plan.json
npm run preflight:overnight -- --plan .preflight/overnight.plan.json
```

Fails closed. Validates every command before running, enforces gate commands per chunk, retries only up to max attempts, and writes resumable state to `.preflight/overnight.state.json` plus handoff notes to `.preflight/agent-log.md`.

---

## Evidence outputs

False-positive labeling:

```bash
npm run preflight:fp-label
```

Outputs:
- `.preflight/fp-review.csv` (fill `human_label` and `notes`)
- `.preflight/fp-summary.json` (estimated FP rate before human adjudication)

Blocked-incidents report:

```bash
npm run preflight:incidents
```

Output: `.preflight/blocked-incidents.md` (recent blocked events for proof / evidence).

Metrics report:

```bash
npm run preflight:report
```

Output: `.preflight/metrics-report.md`.

---

## Merge-gate baseline

Keep this repo (or your fork) as a guardrail baseline layer:

```bash
npm run verify:merge-gates
```

This enforces:
- `typecheck`, `build`, and full test suite (140 tests)
- `preflight:exec` contract behavior (allow safe command, block force-push to `main`)
- Policy-template contract coverage

Only merge additions mapped to a concrete failure mode ticket in `docs/failure-mode-template.md`.

---

## Options

```ts
const pf = createPreflight({
  // Rule sets to load. Default: all. Mix string names and custom Rule objects.
  rules: ['filesystem', 'git', myCustomRule],

  // Policy mode
  policyMode: 'enforce', // enforce | audit-only | warn-only

  // Telemetry
  telemetryPath: '.preflight/telemetry.jsonl',
  telemetryRequired: true,                   // fail-closed if write fails

  // Platform / paths
  platform: 'win32',                         // override for cross-platform tests
  cwd: '/my/project',
  homeDir: '/Users/me',

  // Shell exec override — useful for mocking git in tests
  exec: async (cmd, args, cwd) => { /* ... */ },

  // Manifest
  manifestPath: '/custom/path/.preflight-env.json',
  manifest: {
    repos: { 'my-repo': '/absolute/path' },
    paths: { desktop: '/Users/me/Desktop' },
  },
});
```

Compatibility adapter usage:

```ts
import { validateAdapted } from 'agentpreflight';

const results = await validateAdapted(claudeHookPayload, 'claude', {
  policyMode: 'enforce',
});
```

Adapters: `claude`, `cursor`, `codex`, `openclaw`, and the raw tool-call schema.

Command preflight with safe rewrite:

```ts
const { results, blocked, patchedCall } = await pf.preflightCommand({
  tool: 'bash',
  params: { command: 'git push --force origin feature-x' },
});
```

Auto-patch allowlist (`autoPatchAllowedRules`) constrains what can be rewritten automatically (e.g. `--force` → `--force-with-lease`).

Time-estimation calibration:

```ts
import { recordTimeEstimate, estimateDrift } from 'agentpreflight';

recordTimeEstimate('.preflight/time-estimates.jsonl', {
  taskId: 'phase-2-search',
  bestCaseMinutes: 90,
  p90Minutes: 180,
  actualMinutes: 140,
});
const drift = estimateDrift('.preflight/time-estimates.jsonl');
```

---

## Custom rules

Rules are plain objects. Add your own:

```ts
import { createPreflight } from 'agentpreflight';
import type { Rule } from 'agentpreflight';

const noTodoFiles: Rule = {
  name: 'no-todo-files',
  matches(call) {
    const path = call.params.path ?? call.params.file_path;
    return typeof path === 'string' && call.tool.toLowerCase() === 'write';
  },
  async validate(call) {
    const path = call.params.path as string;
    if (path.toLowerCase().includes('todo')) {
      return {
        status: 'warn',
        rule: 'no-todo-files',
        message: 'Writing a TODO file — use your issue tracker instead',
      };
    }
    return { status: 'pass', rule: 'no-todo-files', message: 'OK' };
  },
};

const pf = createPreflight({ rules: ['filesystem', noTodoFiles] });
```

---

## API

### `createPreflight(options?)`

Returns a `Preflight` instance. By default writes telemetry to `.preflight/telemetry.jsonl`.

### `pf.validate(call)`

```ts
pf.validate(call: ToolCall): Promise<ValidationResult[]>
```

Runs all matching rules. Returns one result per matching rule.

### `pf.addRule(rule)`

Add a custom rule after initialization.

### `getEnv(manifestPath?)`

```ts
getEnv(manifestPath?: string): Promise<EnvManifest | null>
```

Loads `~/.preflight-env.json` (or the specified path). Returns `null` if not found.

### `resolveRepo(manifest, name)` / `resolvePath(manifest, name)`

```ts
resolveRepo(manifest: EnvManifest, name: string): string | null
resolvePath(manifest: EnvManifest, name: string): string | null
```

Returns the absolute local path for a repo or named path. Returns `null` if not declared.

### `loadManifest(manifestPath?)`

Load and parse the manifest file directly.

### `hasFailures(results)` / `hasWarnings(results)`

Booleans. Use `hasFailures` to decide whether to abort a tool call.

### `formatResults(results)` / `summary(results)`

Human-readable multi-line output, and counts by status (`{ pass, warn, fail }`).

---

## Types

```ts
interface ToolCall {
  tool: string;
  params: Record<string, unknown>;
  agentId?: string; // for parallel conflict detection
}

interface ValidationResult {
  status: 'pass' | 'warn' | 'fail';
  rule: string;
  message: string;
  suggestion?: string; // corrected value or next step
}

interface EnvManifest {
  repos: Record<string, string>;  // repo-name → absolute local path
  paths?: Record<string, string>; // named paths (desktop, github, etc.)
}
```

**Tool name matching:** case-insensitive. `write_file`, `Write`, `WRITE` all match.

**Param resolution:** checks `path`, `file_path`, `file`, `command`, `cmd`, `content`, `new_string` for compatibility across common coding tools.

---

## Detailed rules

### `filesystem`

| Rule | Triggers on | Result |
|------|-------------|--------|
| `parent-dir-exists` | write to path whose parent doesn't exist | fail |
| `file-exists-for-read` | read a file that doesn't exist | fail |
| `write-permission` | write to directory without permission | fail |
| `symlink-resolution` | path is a symlink to a different location | warn + real path |
| `sensitive-file-write` | write to `.env`, credentials, keys, etc. | warn |

Matched tools: `write_file`, `write`, `edit`, `edit_file`, `create_file`, `notebookedit`.

### `git`

| Rule | Triggers on | Result |
|------|-------------|--------|
| `force-push-protection` | `git push --force` to main/master | fail |
| `force-push-protection` | `git push --force` to other branches | warn |
| `push-upstream-check` | push with no upstream set | warn |
| `push-upstream-check` | push when branch has diverged | fail |
| `staging-verification` | commit with nothing staged | fail |
| `staging-verification` | sensitive files staged | warn |
| `branch-protection` | destructive ops on main/master | warn |
| `no-verify-detection` | `--no-verify` flag | warn |

Matched tools: `bash` (commands containing `git`).

### `environment`

| Rule | Triggers on | Result |
|------|-------------|--------|
| `onedrive-redirect` | Windows path missing OneDrive segment | warn + corrected path |
| `platform-path-sep` | wrong slash direction for the OS | warn + corrected path |
| `home-dir-resolution` | tilde path (`~/...`) | warn + expanded path |
| `devnull-platform` | `NUL` on Unix or `/dev/null` wrong | warn |
| `repo-path-resolution` | relative repo name resolvable via manifest | warn + absolute path |

Matched tools: all file tools + bash.

### `secrets`

Detects: common API keys and tokens (npm, GitHub, AWS, Stripe, Cloudflare), private-key blocks, and generic `SECRET=` / `API_KEY=` patterns.

| Rule | Triggers on | Result |
|------|-------------|--------|
| `secrets-in-file-content` | write with secret in content | fail |
| `secrets-in-bash-command` | bash command containing secret | warn |

Skipped paths (default): `**/.env.example`, `**/.env.sample`, `**/.env.template`, `**/.env.dist`, `**/*.test.{js,ts,jsx,tsx}`, `**/*.spec.{js,ts,jsx,tsx}`, `**/__fixtures__/**`, `**/__mocks__/**`, `**/fixtures/**`, `**/data/evals/**`, `**/data/test/**`, `**/data/fixtures/**`, `**/*.jsonl`. These are the canonical locations for empty env-var declarations and fictional/eval text where secret-shaped strings are expected.

Customize via policy pack:

```json
{
  "secretsChecks": {
    "additionalIgnoreGlobs": ["**/golden/**"]
  }
}
```

Use `ignoreGlobs` to **replace** the defaults, `additionalIgnoreGlobs` to **extend** them.

The Cloudflare and generic-env-var detectors require key context (e.g. `cloudflare_api_token: "..."`, `API_KEY=value`) — they no longer fire on a bare 40-char alphanumeric run in free-text content, and they do not fire on empty values (`API_KEY=`, `"api_key": ""`).

### `naming`

| Rule | Triggers on | Result |
|------|-------------|--------|
| `no-spaces-in-filename` | spaces in filename | fail |
| `no-uppercase-in-path` | uppercase in filename (configurable) | warn |
| `extension-mismatch` | content doesn't match file extension | warn |

### `network`

| Rule | Triggers on | Result |
|------|-------------|--------|
| `no-http-in-production` | HTTP (not HTTPS) URLs in commands | warn |
| `localhost-in-production` | localhost URLs that look production-bound | warn |

### `parallel`

| Rule | Triggers on | Result |
|------|-------------|--------|
| `cross-agent-file-conflict` | two agents writing the same file | fail |
| `cross-agent-git-conflict` | two agents running git operations | warn |

### `scope`

| Rule | Triggers on | Result |
|------|-------------|--------|
| `write-outside-cwd` | write to path outside working directory | warn |
| `bash-dangerous-command` | `rm -rf`, `chmod 777`, `sudo`, etc. | warn or fail |

### `editorial`

State-driven prose discipline (locked phrases, banned words, required terms). Configured via `.preflight/editorial-state.json` and the `editorial.preflight.policy.json` policy pack. Use `agentpreflight-setup-editorial` to scaffold.

### `session`

Session checkpoints before destructive commands. Records intent + decision points so a later agent can resume without re-deriving context.

### `time-estimation`

Calibration drift on `bestCase` / `p90` / `actual` minutes. Optionally requires mandatory calibration context before recording new estimates. Drift across the JSONL log surfaces consistent over- or under-estimation.

### `prewrite`

Pre-write external toolchain gates (`lintCommand`, `typecheckCommand`) configurable per file extension. Fails closed if the lint or typecheck fails before the write.

### `release`

| Rule | Triggers on | Result |
|------|-------------|--------|
| `release-claim-requires-evidence` | completion claims like "done / live / fixed" without an evidence table | fail |

Required evidence-table shape:

`| URL | Action | Expected | Actual | Pass/Fail |`

---

## Policy-pack templates

- `templates/startup-safe.preflight.policy.json`
- `templates/enterprise.preflight.policy.json`
- `templates/speed.preflight.policy.json`
- `templates/editorial.preflight.policy.json`
- `templates/quickstart.preflight.policy.json`

CI replay mode:

```bash
npm run preflight:ci -- ./tool-calls.json
```

---

## Stats

- 140 tests passing across 26 test files
- 13 rule sets, 7 of them workflow / personal-discipline
- 0 runtime dependencies (only Node builtins)
- 455 KB unpacked, 35 files on npm

---

## License

MIT — Kayla Cardillo / [Tech Enrichment](https://techenrichment.com)
