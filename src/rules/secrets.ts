import type { Rule, ToolCall, ValidationResult, PreflightContext } from '../types.js';

const WRITE_TOOLS = new Set([
  'write_file', 'write', 'edit', 'edit_file', 'create_file', 'notebookedit',
]);

const BASH_TOOLS = new Set(['bash', 'shell', 'run_command', 'execute']);

interface SecretPattern {
  name: string;
  pattern: RegExp;
}

/**
 * High-confidence secret patterns. Each pattern has a recognizable prefix or
 * structural anchor that makes false positives in free-text content unlikely.
 *
 * Patterns that depended on a bare 40-char alphanumeric run (the original
 * Cloudflare API token regex) are NOT in this list — they live in
 * `CONTEXTUAL_PATTERNS` below and require key context to fire.
 */
const SECRET_PATTERNS: SecretPattern[] = [
  { name: 'OpenAI API key',         pattern: /sk-[a-zA-Z0-9]{20,}/ },
  { name: 'Anthropic API key',      pattern: /sk-ant-[a-zA-Z0-9\-]{20,}/ },
  { name: 'npm token',              pattern: /npm_[a-zA-Z0-9]{30,}/ },
  { name: 'GitHub token',           pattern: /gh[ps]_[a-zA-Z0-9]{36,}/ },
  { name: 'AWS access key',         pattern: /AKIA[0-9A-Z]{16}/ },
  { name: 'AWS secret key',         pattern: /aws_secret_access_key\s*=\s*[a-zA-Z0-9+/]{40}/i },
  { name: 'Stripe key',             pattern: /sk_live_[a-zA-Z0-9]{24,}/ },
  { name: 'Stripe test key',        pattern: /sk_test_[a-zA-Z0-9]{24,}/ },
  { name: 'Private key block',      pattern: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
];

/**
 * Patterns that are too generic on their own (would match plain English) and
 * therefore require key context (a likely-secret key name within ~30 chars
 * before the value, or `=` / `:` / `"` separator in a structured context).
 *
 * Each entry is a key-context regex paired with the value regex. The full
 * compiled match below uses a non-capturing group of the key context plus a
 * short separator, then the value pattern.
 */
// Key/value patterns must tolerate JSON-style quoting around the key:
// `"cloudflare_api_token": "value"`, YAML/INI-style `key: value`, and env-style
// `KEY=value`. We allow an optional closing quote on the key, optional
// whitespace, then `:` or `=`, then optional whitespace and an optional
// opening quote on the value.
//
// Whitespace between the keyword and the value uses `[ \t]` (not `\s`) so the
// key and the value must be on the SAME LINE. Plain `\s` matches `\n`, which
// produces false positives in prose documents where an "API token" mention is
// followed many lines later by an unrelated 37-40 char alphanumeric string
// (filenames, commit hashes, IDs).
const CLOUDFLARE_KEY_CONTEXT =
  /(?:cloudflare[_\-]?api[_\-]?token|cloudflare[_\-]?token|cf[_\-](?:api[_\-]?)?token|api[_\-]?token)["']?[ \t]*[:=][ \t]*["']?([a-zA-Z0-9_\-]{37,40})["']?/i;

const CONTEXTUAL_PATTERNS: SecretPattern[] = [
  { name: 'Cloudflare API token', pattern: CLOUDFLARE_KEY_CONTEXT },
];

/**
 * Generic env-var-style secret pattern.
 *
 * Original regex used `\s*` around `=` and after the value, which let the
 * value side cross newlines. That meant `ANTHROPIC_API_KEY=\nANTHROPIC_MODEL=
 * claude-sonnet-4-6` matched as if `ANTHROPIC_MODEL=claude-sonnet-4-6` were
 * the value of `ANTHROPIC_API_KEY` — the source of the `.env.example` false
 * positive on 2026-05-05.
 *
 * Fix: only horizontal whitespace (` ` / `\t`) between the key and `=` and
 * between `=` and the value, and the value cannot contain newlines. An empty
 * value (`KEY=`, `KEY=""`, `KEY=''`) is not a secret — there is nothing to
 * leak — so the pattern requires 16+ value chars before firing.
 */
const GENERIC_SECRET_PATTERN =
  /(SECRET|PASSWORD|PASSWD|API_KEY|AUTH_TOKEN|PRIVATE_KEY)[ \t]*=[ \t]*(?:"([^"\n]{16,})"|'([^'\n]{16,})'|([a-zA-Z0-9+/=_\-]{16,}))/i;

const GENERIC_SECRET: SecretPattern = {
  name: 'Generic secret env var',
  pattern: GENERIC_SECRET_PATTERN,
};

/**
 * Default set of file path globs that are skipped for ALL secret detection
 * rules. These cover the canonical locations where empty env-var declarations
 * and fictional/eval text live.
 */
export const DEFAULT_SECRETS_IGNORE_GLOBS: string[] = [
  '**/.env.example',
  '**/.env.sample',
  '**/.env.template',
  '**/.env.dist',
  '**/.env.example.*',
  '**/.env.sample.*',
  '**/*.test.js',
  '**/*.test.ts',
  '**/*.test.jsx',
  '**/*.test.tsx',
  '**/*.spec.js',
  '**/*.spec.ts',
  '**/*.spec.jsx',
  '**/*.spec.tsx',
  '**/__fixtures__/**',
  '**/__mocks__/**',
  '**/fixtures/**',
  '**/data/evals/**',
  '**/data/test/**',
  '**/data/fixtures/**',
  '**/*.jsonl',
];

/** Convert a glob to a RegExp. Supports `**`, `*`, `?`, and brace alternation `{a,b}`. */
function globToRegExp(glob: string): RegExp {
  // Normalize separators to forward slash for matching.
  let g = glob.replace(/\\/g, '/');
  let re = '';
  let i = 0;
  while (i < g.length) {
    const ch = g[i];
    if (ch === '*') {
      if (g[i + 1] === '*') {
        // ** matches any number of path segments (including zero)
        if (g[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 3;
        } else {
          re += '.*';
          i += 2;
        }
      } else {
        re += '[^/]*';
        i += 1;
      }
    } else if (ch === '?') {
      re += '[^/]';
      i += 1;
    } else if (ch === '{') {
      const end = g.indexOf('}', i);
      if (end === -1) {
        re += '\\{';
        i += 1;
      } else {
        const opts = g.slice(i + 1, end).split(',').map((o) => o.replace(/[.+^${}()|[\]\\]/g, '\\$&'));
        re += '(?:' + opts.join('|') + ')';
        i = end + 1;
      }
    } else if ('.+^${}()|[]\\'.includes(ch)) {
      re += '\\' + ch;
      i += 1;
    } else {
      re += ch;
      i += 1;
    }
  }
  return new RegExp('^' + re + '$', 'i');
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

function getPath(call: ToolCall): string | null {
  const p = call.params.path ?? call.params.file_path ?? call.params.file ?? null;
  return typeof p === 'string' ? p : null;
}

function getContent(call: ToolCall): string | null {
  const c = call.params.content ?? call.params.new_string ?? call.params.source ?? null;
  return typeof c === 'string' ? c : null;
}

function getCommand(call: ToolCall): string | null {
  const c = call.params.command ?? call.params.cmd ?? null;
  return typeof c === 'string' ? c : null;
}

function resolveIgnoreGlobs(context?: PreflightContext): string[] {
  const config = context?.policyPack?.secretsChecks;
  if (!config) return DEFAULT_SECRETS_IGNORE_GLOBS;
  const base = config.ignoreGlobs ?? DEFAULT_SECRETS_IGNORE_GLOBS;
  if (config.additionalIgnoreGlobs && config.additionalIgnoreGlobs.length > 0) {
    return [...base, ...config.additionalIgnoreGlobs];
  }
  return base;
}

function isPathIgnored(path: string | null, context?: PreflightContext): boolean {
  if (!path) return false;
  const normalized = normalizePath(path);
  const globs = resolveIgnoreGlobs(context);
  for (const glob of globs) {
    if (globToRegExp(glob).test(normalized)) return true;
  }
  return false;
}

function detectSecrets(text: string): SecretPattern | null {
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.pattern.test(text)) return pattern;
  }
  if (GENERIC_SECRET.pattern.test(text)) return GENERIC_SECRET;
  for (const pattern of CONTEXTUAL_PATTERNS) {
    if (pattern.pattern.test(text)) return pattern;
  }
  return null;
}

const secretInFileContent: Rule = {
  name: 'secrets-in-file-content',
  matches(call) {
    return WRITE_TOOLS.has(call.tool.toLowerCase()) && getContent(call) !== null;
  },
  async validate(call, context): Promise<ValidationResult> {
    const path = getPath(call);
    if (isPathIgnored(path, context)) {
      return {
        status: 'pass',
        rule: 'secrets-in-file-content',
        message: `Skipped: ${path} matches secrets ignore list (example/fixture/eval)`,
      };
    }

    const content = getContent(call)!;
    const match = detectSecrets(content);

    if (match) {
      return {
        status: 'fail',
        rule: 'secrets-in-file-content',
        message: `Possible ${match.name} detected in file content`,
        suggestion: 'Store secrets in environment variables, not in files',
      };
    }

    return { status: 'pass', rule: 'secrets-in-file-content', message: 'No secrets detected in content' };
  },
};

const secretInBashCommand: Rule = {
  name: 'secrets-in-bash-command',
  matches(call) {
    return BASH_TOOLS.has(call.tool.toLowerCase()) && getCommand(call) !== null;
  },
  async validate(call): Promise<ValidationResult> {
    const cmd = getCommand(call)!;
    const match = detectSecrets(cmd);

    if (match) {
      return {
        status: 'warn',
        rule: 'secrets-in-bash-command',
        message: `Possible ${match.name} detected in shell command`,
        suggestion: 'Use environment variables instead of inlining secrets in commands',
      };
    }

    return { status: 'pass', rule: 'secrets-in-bash-command', message: 'No secrets detected in command' };
  },
};

export const secretsRules: Rule[] = [
  secretInFileContent,
  secretInBashCommand,
];
