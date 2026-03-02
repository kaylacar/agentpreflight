import type { Rule, ToolCall, ValidationResult } from '../types.js';

const WRITE_TOOLS = new Set([
  'write_file', 'write', 'edit', 'edit_file', 'create_file', 'notebookedit',
]);

const BASH_TOOLS = new Set(['bash', 'shell', 'run_command', 'execute']);

interface SecretPattern {
  name: string;
  pattern: RegExp;
}

const SECRET_PATTERNS: SecretPattern[] = [
  { name: 'OpenAI API key',         pattern: /sk-[a-zA-Z0-9]{20,}/ },
  { name: 'Anthropic API key',      pattern: /sk-ant-[a-zA-Z0-9\-]{20,}/ },
  { name: 'npm token',              pattern: /npm_[a-zA-Z0-9]{30,}/ },
  { name: 'GitHub token',           pattern: /gh[ps]_[a-zA-Z0-9]{36,}/ },
  { name: 'AWS access key',         pattern: /AKIA[0-9A-Z]{16}/ },
  { name: 'AWS secret key',         pattern: /aws_secret_access_key\s*=\s*[a-zA-Z0-9+/]{40}/i },
  { name: 'Stripe key',             pattern: /sk_live_[a-zA-Z0-9]{24,}/ },
  { name: 'Stripe test key',        pattern: /sk_test_[a-zA-Z0-9]{24,}/ },
  { name: 'Cloudflare API token',   pattern: /cf[_-][a-zA-Z0-9_\-]{35,}/ },
  { name: 'Generic secret env var', pattern: /(SECRET|PASSWORD|PASSWD|API_KEY|AUTH_TOKEN|PRIVATE_KEY)\s*=\s*["']?[a-zA-Z0-9+/=_\-]{16,}["']?/i },
  { name: 'Private key block',      pattern: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
];

function getContent(call: ToolCall): string | null {
  const c = call.params.content ?? call.params.new_string ?? call.params.source ?? null;
  return typeof c === 'string' ? c : null;
}

function getCommand(call: ToolCall): string | null {
  const c = call.params.command ?? call.params.cmd ?? null;
  return typeof c === 'string' ? c : null;
}

function detectSecrets(text: string): SecretPattern | null {
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.pattern.test(text)) return pattern;
  }
  return null;
}

const secretInFileContent: Rule = {
  name: 'secrets-in-file-content',
  matches(call) {
    return WRITE_TOOLS.has(call.tool.toLowerCase()) && getContent(call) !== null;
  },
  async validate(call): Promise<ValidationResult> {
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
