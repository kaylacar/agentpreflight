import type { Rule, ToolCall, ValidationResult } from '../types.js';

const NETWORK_TOOLS = new Set([
  'web_fetch', 'webfetch', 'fetch', 'http_request', 'httprequest',
  'curl', 'wget', 'request', 'get', 'post',
]);

const BASH_TOOLS = new Set(['bash', 'shell', 'run_command', 'execute']);

const INTERNAL_IP = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|localhost|0\.0\.0\.0)/i;

const DANGEROUS_PROTOCOLS = /^(file:|javascript:|data:|ftp:)/i;

const SECRET_HEADER_KEYS = /^(authorization|x-api-key|x-auth-token|api-key|secret|password|token)/i;

const SECRET_HEADER_VALUES = /^(bearer\s+[a-z0-9_\-\.]{20,}|basic\s+[a-z0-9+/=]{20,}|[a-z0-9_\-]{32,})/i;

function getUrl(call: ToolCall): string | null {
  const u = call.params.url ?? call.params.uri ?? call.params.href ?? null;
  return typeof u === 'string' ? u : null;
}

function extractBashUrls(cmd: string): string[] {
  const matches = cmd.match(/https?:\/\/[^\s"']+/g);
  return matches ?? [];
}

const dangerousProtocol: Rule = {
  name: 'network-dangerous-protocol',
  matches(call) {
    if (NETWORK_TOOLS.has(call.tool.toLowerCase())) return getUrl(call) !== null;
    if (BASH_TOOLS.has(call.tool.toLowerCase())) {
      const cmd = call.params.command ?? call.params.cmd ?? '';
      return typeof cmd === 'string' && /file:|javascript:|data:|ftp:/i.test(cmd);
    }
    return false;
  },
  async validate(call): Promise<ValidationResult> {
    const url = getUrl(call);
    if (url && DANGEROUS_PROTOCOLS.test(url)) {
      return {
        status: 'fail',
        rule: 'network-dangerous-protocol',
        message: `Dangerous protocol in URL: ${url}`,
        suggestion: 'Use https:// for external requests',
      };
    }
    return { status: 'pass', rule: 'network-dangerous-protocol', message: 'Protocol OK' };
  },
};

const internalNetworkAccess: Rule = {
  name: 'network-internal-access',
  matches(call) {
    if (NETWORK_TOOLS.has(call.tool.toLowerCase())) return getUrl(call) !== null;
    if (BASH_TOOLS.has(call.tool.toLowerCase())) {
      const cmd = call.params.command ?? call.params.cmd ?? '';
      return typeof cmd === 'string' && /https?:\/\//i.test(cmd);
    }
    return false;
  },
  async validate(call): Promise<ValidationResult> {
    const url = getUrl(call);
    const urls = url ? [url] : [];

    if (BASH_TOOLS.has(call.tool.toLowerCase())) {
      const cmd = call.params.command ?? call.params.cmd ?? '';
      if (typeof cmd === 'string') urls.push(...extractBashUrls(cmd));
    }

    for (const u of urls) {
      try {
        const parsed = new URL(u);
        if (INTERNAL_IP.test(parsed.hostname)) {
          return {
            status: 'warn',
            rule: 'network-internal-access',
            message: `Request targets internal network address: ${parsed.hostname}`,
            suggestion: 'Confirm this is intentional — internal network requests can expose private services',
          };
        }
      } catch {
        // unparseable URL — skip
      }
    }

    return { status: 'pass', rule: 'network-internal-access', message: 'No internal network access detected' };
  },
};

const secretInHeaders: Rule = {
  name: 'network-secret-in-headers',
  matches(call) {
    return NETWORK_TOOLS.has(call.tool.toLowerCase()) && typeof call.params.headers === 'object' && call.params.headers !== null;
  },
  async validate(call): Promise<ValidationResult> {
    const headers = call.params.headers as Record<string, unknown>;

    for (const [key, value] of Object.entries(headers)) {
      if (SECRET_HEADER_KEYS.test(key) && typeof value === 'string' && SECRET_HEADER_VALUES.test(value)) {
        return {
          status: 'warn',
          rule: 'network-secret-in-headers',
          message: `Possible secret in header: ${key}`,
          suggestion: 'Load credentials from environment variables rather than hardcoding them',
        };
      }
    }

    return { status: 'pass', rule: 'network-secret-in-headers', message: 'No secrets detected in headers' };
  },
};

const httpNotHttps: Rule = {
  name: 'network-http-not-https',
  matches(call) {
    return NETWORK_TOOLS.has(call.tool.toLowerCase()) && getUrl(call) !== null;
  },
  async validate(call): Promise<ValidationResult> {
    const url = getUrl(call)!;
    if (url.startsWith('http://')) {
      return {
        status: 'warn',
        rule: 'network-http-not-https',
        message: `Unencrypted HTTP request: ${url}`,
        suggestion: 'Use https:// to encrypt the request',
      };
    }
    return { status: 'pass', rule: 'network-http-not-https', message: 'HTTPS OK' };
  },
};

export const networkRules: Rule[] = [
  dangerousProtocol,
  internalNetworkAccess,
  secretInHeaders,
  httpNotHttps,
];
