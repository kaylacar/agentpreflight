# agentpreflight

Pre-flight validation for AI tool calls. Catches mistakes before they execute.

```
npm install agentpreflight
```

---

## What it does

AI coding agents make the same mistakes constantly — writing to paths that don't exist, force-pushing to main, committing secrets, not knowing where repos live on the machine. Agentpreflight intercepts tool calls before they run and validates them against the actual system state.

```ts
import { createPreflight, hasFailures } from 'agentpreflight';

const pf = createPreflight();

const results = await pf.validate({
  tool: 'bash',
  params: { command: 'git push --force origin main' },
});

if (hasFailures(results)) {
  // don't execute — agent gets a clear reason why
}
```

---

## For agents

**Purpose:** Pre-flight validation SDK for AI agent tool calls. Prevents filesystem errors, git mistakes, secret leaks, and path resolution failures before execution.

**Capabilities:**
- Validate tool calls before execution (`filesystem`, `git`, `secrets`, `environment`, `naming`, `network`, `parallel`, `scope`)
- Resolve local repo paths without asking the user (`getEnv`, `resolveRepo`)
- Detect and correct platform path errors, OneDrive redirects, wrong separators
- Block force pushes to main, secret commits, writes to nonexistent directories
- Catch cross-agent file conflicts in parallel execution environments

**Integration pattern:**

```ts
import { createPreflight, getEnv, hasFailures } from 'agentpreflight';

// Step 1 — session start: resolve local environment
const env = await getEnv(); // reads ~/.preflight-env.json
// env.repos → { 'repo-name': '/absolute/local/path', ... }
// env.paths → { 'desktop': '/absolute/path', ... }

// Step 2 — before every tool call: validate
const pf = createPreflight();
const results = await pf.validate({ tool: 'write', params: { path: '...' } });

// Step 3 — act on results
if (hasFailures(results)) { /* abort */ }
// result.suggestion contains corrected value when status === 'warn'
```

**Result schema:**
```ts
{ status: 'pass' | 'warn' | 'fail', rule: string, message: string, suggestion?: string }
```

**When `status === 'warn'`:** check `suggestion` — it contains the corrected path, safer command, or next step.

**When `status === 'fail'`:** do not execute the tool call.

**Tool name matching:** case-insensitive. `write_file`, `Write`, `WRITE` all match.

**Param resolution:** checks `path`, `file_path`, `file`, `command`, `cmd`, `content`, `new_string` — covers Claude Code, Cursor, Copilot, and other coding assistants.

---

## Claude Code global hook

Install once. Validates every tool call Claude makes, across every project, permanently. Each blocked call saves ~800 tokens — the failed tool output, the error, and the retry.

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
  "dependencies": { "agentpreflight": "^0.1.0" }
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

**Real blocks in production:**

```
agentpreflight blocked Bash:
[FAIL] staging-verification: Nothing is staged for commit
       → Use git add to stage files first
```
Claude ran `git add README.md && git commit -m "..."` as one chained command. The commit ran before staging completed. Blocked. Claude split into two calls.

```
agentpreflight blocked Read:
[FAIL] file-exists-for-read: File does not exist: ./config/settings.json
```
Claude tried to read a config file before it was created. Blocked before the round-trip.

---

## Installation

```bash
npm install agentpreflight
# or
pnpm add agentpreflight
# or
yarn add agentpreflight
```

Requires Node 18+. ESM only. Zero runtime dependencies.

---

## Quick start

```ts
import { createPreflight, hasFailures, hasWarnings, formatResults } from 'agentpreflight';

const pf = createPreflight(); // loads all rule sets by default

const results = await pf.validate({
  tool: 'write',
  params: { path: '/nonexistent/dir/file.txt', content: 'hello' },
});

console.log(formatResults(results));
// [FAIL] parent-dir-exists: Parent directory does not exist: /nonexistent/dir
//   → Create it first, or check the path

if (hasFailures(results)) {
  // abort
}
```

---

## Environment manifest

The most common agent friction point: not knowing where things are on the machine.

Create `~/.preflight-env.json` to declare your local environment once:

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

const env = await getEnv();
// returns null if ~/.preflight-env.json doesn't exist — not an error

if (env) {
  resolveRepo(env, 'my-repo');     // → '/absolute/path/to/my-repo'
  resolvePath(env, 'desktop');     // → '/Users/you/Desktop'
  resolveRepo(env, 'unknown');     // → null
}
```

The `repo-path-resolution` rule also uses the manifest automatically. If an agent passes a relative repo name as a path, it gets a `warn` result with the resolved absolute path in `suggestion`.

**On Windows with OneDrive**, agentpreflight already knows that `Desktop` and `Documents` are likely redirected. The `onedrive-redirect` rule catches this automatically — no manifest needed for that.

---

## Rule sets

All rule sets are loaded by default. Load only what you need:

```ts
const pf = createPreflight({ rules: ['filesystem', 'git', 'secrets'] });
```

### `filesystem`

Validates file operations before they touch disk.

| Rule | Triggers on | Result |
|------|-------------|--------|
| `parent-dir-exists` | write to path whose parent doesn't exist | fail |
| `file-exists-for-read` | read a file that doesn't exist | fail |
| `write-permission` | write to directory without permission | fail |
| `symlink-resolution` | path is a symlink to a different location | warn + real path |
| `sensitive-file-write` | write to `.env`, credentials, keys, etc. | warn |

**Matched tools:** `write_file`, `write`, `edit`, `edit_file`, `create_file`, `notebookedit`

### `git`

Validates git operations in bash commands.

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

**Matched tools:** `bash` (commands containing `git`)

### `environment`

Catches platform and path mismatches.

| Rule | Triggers on | Result |
|------|-------------|--------|
| `onedrive-redirect` | Windows path missing OneDrive segment | warn + corrected path |
| `platform-path-sep` | wrong slash direction for the OS | warn + corrected path |
| `home-dir-resolution` | tilde path (`~/...`) | warn + expanded path |
| `devnull-platform` | `NUL` on Unix or `/dev/null` wrong | warn |
| `repo-path-resolution` | relative repo name resolvable via manifest | warn + absolute path |

**Matched tools:** all file tools + bash

### `secrets`

Scans file content and shell commands for credentials.

Detects: OpenAI keys, Anthropic keys, npm tokens, GitHub tokens, AWS keys, Stripe keys, Cloudflare tokens, private key blocks, generic `SECRET=` / `API_KEY=` patterns.

| Rule | Triggers on | Result |
|------|-------------|--------|
| `secrets-in-file-content` | write with secret in content | fail |
| `secrets-in-bash-command` | bash command containing secret | warn |

### `naming`

Enforces file naming conventions and catches common mistakes.

| Rule | Triggers on | Result |
|------|-------------|--------|
| `no-spaces-in-filename` | spaces in filename | fail |
| `no-uppercase-in-path` | uppercase in filename (configurable) | warn |
| `extension-mismatch` | content doesn't match file extension | warn |

### `network`

Validates network operations in bash commands.

| Rule | Triggers on | Result |
|------|-------------|--------|
| `no-http-in-production` | HTTP (not HTTPS) URLs in commands | warn |
| `localhost-in-production` | localhost URLs that look production-bound | warn |

### `parallel`

Detects conflicts when multiple agents run simultaneously.

| Rule | Triggers on | Result |
|------|-------------|--------|
| `cross-agent-file-conflict` | two agents writing the same file | fail |
| `cross-agent-git-conflict` | two agents running git operations | warn |

### `scope`

Catches tool calls that exceed what was asked.

| Rule | Triggers on | Result |
|------|-------------|--------|
| `write-outside-cwd` | write to path outside working directory | warn |
| `bash-dangerous-command` | `rm -rf`, `chmod 777`, `sudo`, etc. | warn or fail |

---

## Options

```ts
const pf = createPreflight({
  // Rule sets to load. Default: all. Mix strings and custom Rule objects.
  rules: ['filesystem', 'git', myCustomRule],

  // Platform override — useful for cross-platform testing
  platform: 'win32',

  // Working directory override
  cwd: '/my/project',

  // Home directory override
  homeDir: '/Users/me',

  // Shell exec override — useful for mocking git in tests
  exec: async (cmd, args, cwd) => { ... },

  // Path to manifest file (default: ~/.preflight-env.json)
  manifestPath: '/custom/path/.preflight-env.json',

  // Inline manifest — skips file loading, useful for testing
  manifest: {
    repos: { 'my-repo': '/absolute/path' },
    paths: { desktop: '/Users/me/Desktop' },
  },
});
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

Returns a `Preflight` instance.

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

### `resolveRepo(manifest, name)`

```ts
resolveRepo(manifest: EnvManifest, name: string): string | null
```

Returns the absolute local path for a repo name. Returns `null` if not in manifest.

### `resolvePath(manifest, name)`

```ts
resolvePath(manifest: EnvManifest, name: string): string | null
```

Returns the absolute local path for a named path. Returns `null` if not declared.

### `loadManifest(manifestPath?)`

```ts
loadManifest(manifestPath?: string): Promise<EnvManifest | null>
```

Load and parse the manifest file directly.

### `hasFailures(results)`

```ts
hasFailures(results: ValidationResult[]): boolean
```

Returns `true` if any result has `status: 'fail'`. Use this to decide whether to abort a tool call.

### `hasWarnings(results)`

```ts
hasWarnings(results: ValidationResult[]): boolean
```

Returns `true` if any result has `status: 'warn'`.

### `formatResults(results)`

```ts
formatResults(results: ValidationResult[]): string
```

Human-readable multi-line output. Each result includes status, rule name, message, and suggestion if present.

### `summary(results)`

```ts
summary(results: ValidationResult[]): { pass: number; warn: number; fail: number }
```

Counts by status.

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

---

## License

MIT — Kayla Cardillo / [Tech Enrichment](https://techenrichment.com)
