# agentpreflight

Pre-flight validation for AI tool calls. Intercepts every file read, write, bash command, and git operation — catches mistakes before they execute.

**AI tools fail constantly on bad paths, missing files, unstaged commits, and hardcoded secrets. agentpreflight catches these before the call goes out, not after.**

```bash
npm install agentpreflight
```

---

## Quick Start — Claude Code global hook

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
  "dependencies": {
    "agentpreflight": "^0.1.0"
  }
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
        "hooks": [
          {
            "type": "command",
            "command": "node C:/Users/YOU/.claude/hooks/preflight.mjs",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

Replace `C:/Users/YOU` with your actual home path. Use forward slashes even on Windows. Start a new Claude Code session — hooks load at startup.

---

## Track it as an experiment

The hook logs every intercepted call. Save this as `~/.claude/hooks/stats.mjs` and run it any time:

```js
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const lines = readFileSync(join(__dirname, 'preflight.log'), 'utf8').trim().split('\n').filter(Boolean);

let total = 0, blocked = 0, passed = 0;
const blocksByRule = {}, blocksByTool = {}, passByTool = {};

for (const line of lines) {
  const p = line.match(/PASSED (\w+)/);
  const b = line.match(/BLOCKED (\w+)/);
  const f = line.match(/\[FAIL\] ([^:]+)/);
  if (p) { total++; passed++; passByTool[p[1]] = (passByTool[p[1]] ?? 0) + 1; }
  else if (b) { total++; blocked++; blocksByTool[b[1]] = (blocksByTool[b[1]] ?? 0) + 1; }
  if (f) { const r = f[1].trim(); blocksByRule[r] = (blocksByRule[r] ?? 0) + 1; }
}

console.log(`\n=== agentpreflight stats ===`);
console.log(`Total intercepted: ${total} | Passed: ${passed} | Blocked: ${blocked}`);
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

Each blocked call saves roughly 800 tokens — the failed tool output, the error, and the retry.

---

## What it catches

### filesystem
| Rule | Triggers when |
|------|--------------|
| `file-exists-for-read` | Reading a file that doesn't exist |
| `parent-dir-exists` | Writing to a directory that hasn't been created |
| `write-permission` | Writing to a directory you don't have access to |
| `sensitive-file-write` | Writing to `.env`, `credentials.json`, `.pem`, `id_rsa` |
| `symlink-resolution` | Path is a symlink pointing somewhere unexpected |

### git
| Rule | Triggers when |
|------|--------------|
| `staging-verification` | `git commit` with nothing staged |
| `force-push-protection` | Force push to `main`/`master` (fail) or any branch (warn) |
| `push-upstream-check` | Branch has diverged from or is behind upstream |
| `branch-protection` | `reset --hard`, `branch -D`, `clean -f` on main/master |
| `no-verify-detection` | `--no-verify` flag bypasses git hooks |

### secrets
| Rule | Triggers when |
|------|--------------|
| `secrets-in-file-content` | API key or token detected in file being written |
| `secrets-in-bash-command` | Secret inlined in a shell command |

Detected patterns: OpenAI (`sk-...`), Anthropic (`sk-ant-...`), GitHub (`ghp_...`), AWS, Stripe, generic `API_KEY=...`, PEM blocks.

### environment
| Rule | Triggers when |
|------|--------------|
| `onedrive-redirect` | Path uses `C:\Users\x\Desktop` when it's `C:\Users\x\OneDrive\Desktop` |
| `platform-path-sep` | Wrong slash direction for the OS |
| `home-dir-resolution` | Path starts with `~` |
| `devnull-platform` | `NUL` on Unix or `/dev/null` on Windows |

### naming
| Rule | Triggers when |
|------|--------------|
| `file-naming-convention` | New file uses camelCase; sibling files are all kebab-case |
| `naming-mistakes` | Double extension (`.ts.ts`), spaces in filename |

### network
| Rule | Triggers when |
|------|--------------|
| `network-dangerous-protocol` | `file://`, `javascript://`, `data://` URL |
| `network-internal-access` | Request targets `127.x`, `10.x`, `192.168.x`, `localhost` |
| `network-secret-in-headers` | API key or token in request headers |
| `network-http-not-https` | Unencrypted HTTP request |

### scope
| Rule | Triggers when |
|------|--------------|
| `scope-path-traversal` | `../../../` path escapes the working directory |
| `scope-system-dir-write` | Write to `/etc/`, `/usr/`, `C:\Windows\`, `C:\Program Files\` |

### parallel
Cross-agent conflict detection. When multiple agents run simultaneously and target the same files or git operations, parallel rules flag the conflict before either call executes.

---

## Real examples

**Unstaged commit — blocked**
```
agentpreflight blocked Bash:
[FAIL] staging-verification: Nothing is staged for commit
       -> Use git add to stage files first
```
Claude ran `git add README.md && git commit -m "..."` as one chained command. The commit executed before staging completed. Blocked. Claude split into two calls.

**Missing file — blocked**
```
agentpreflight blocked Read:
[FAIL] file-exists-for-read: File does not exist: ./config/settings.json
```
Claude tried to read a config file that hadn't been created yet. Blocked before the tool call went out — no failed read, no retry.

**Hardcoded secret — blocked**
```
agentpreflight blocked Write:
[FAIL] secrets-in-file-content: Possible Anthropic API key detected in file content
       -> Store secrets in environment variables, not in files
```

**OneDrive redirect — warned (Windows)**
```
[WARN] onedrive-redirect: Desktop is redirected to OneDrive
       -> C:\Users\kayla\OneDrive\Desktop\notes.txt
```
Claude used the non-redirected Desktop path. Corrected path shown inline.

---

## Use in a pipeline

```ts
import { createPreflight, hasFailures, formatResults } from 'agentpreflight';

const pf = createPreflight({
  rules: ['filesystem', 'git', 'secrets'],
});

const results = await pf.validate({
  tool: 'write_file',
  params: { path: './src/config.ts', content: fileContent },
});

if (hasFailures(results)) {
  console.error(formatResults(results));
  // block the tool call
}
```

## Custom rules

```ts
import { createPreflight } from 'agentpreflight';
import type { Rule } from 'agentpreflight';

const noProductionWrites: Rule = {
  name: 'no-production-writes',
  matches: (call) => call.tool === 'write_file',
  validate: async (call) => {
    const path = String(call.params.path ?? '');
    if (path.includes('/production/') || path.includes('/prod/')) {
      return {
        status: 'fail',
        rule: 'no-production-writes',
        message: 'Direct writes to production are blocked',
      };
    }
    return { status: 'pass', rule: 'no-production-writes', message: 'OK' };
  },
};

const pf = createPreflight({ rules: ['filesystem', noProductionWrites] });
```

## License

MIT
