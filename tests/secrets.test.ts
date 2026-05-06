import { describe, it, expect } from 'vitest';
import { createPreflight } from '../src/index.js';

const pf = createPreflight({ rules: ['secrets'] });

describe('secrets-in-file-content', () => {
  it('fails on OpenAI key in file content', async () => {
    const results = await pf.validate({
      tool: 'write',
      params: { path: 'config.ts', content: 'const key = "sk-abcdefghijklmnopqrstuvwxyz123456"' },
    });
    expect(results.find(r => r.rule === 'secrets-in-file-content')?.status).toBe('fail');
  });

  it('fails on npm token in file content', async () => {
    const results = await pf.validate({
      tool: 'write',
      params: { path: '.npmrc', content: '//registry.npmjs.org/:_authToken=npm_abcdefghijklmnopqrstuvwxyz1234567890' },
    });
    expect(results.find(r => r.rule === 'secrets-in-file-content')?.status).toBe('fail');
  });

  it('fails on GitHub token in file content', async () => {
    const results = await pf.validate({
      tool: 'write',
      params: { path: 'deploy.sh', content: 'TOKEN=ghp_abcdefghijklmnopqrstuvwxyz1234567890ab' },
    });
    expect(results.find(r => r.rule === 'secrets-in-file-content')?.status).toBe('fail');
  });

  it('fails on private key block', async () => {
    const results = await pf.validate({
      tool: 'write',
      params: { path: 'key.pem', content: '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAK...' },
    });
    expect(results.find(r => r.rule === 'secrets-in-file-content')?.status).toBe('fail');
  });

  it('passes on normal file content', async () => {
    const results = await pf.validate({
      tool: 'write',
      params: { path: 'index.ts', content: 'export function hello() { return "world"; }' },
    });
    expect(results.find(r => r.rule === 'secrets-in-file-content')?.status).toBe('pass');
  });
});

describe('secrets-in-file-content — false positive fixes (2026-05-05)', () => {
  // FP1: .env.example with empty values must not be flagged.
  it('passes on .env.example with empty values (FP1)', async () => {
    const content = [
      'PORT=3000',
      'NODE_ENV=production',
      'LLM_PROVIDER=anthropic',
      'ANTHROPIC_API_KEY=',
      'ANTHROPIC_MODEL=claude-sonnet-4-6',
      'OPENAI_API_KEY=',
      'OPENAI_MODEL=gpt-4o',
      'LLM_TIMEOUT_MS=60000',
    ].join('\n');
    const results = await pf.validate({
      tool: 'write',
      params: { path: '.env.example', content },
    });
    expect(results.find(r => r.rule === 'secrets-in-file-content')?.status).toBe('pass');
  });

  it('passes on .env.sample / .env.template / .env.dist', async () => {
    for (const path of ['.env.sample', '.env.template', '.env.dist', 'project/.env.example']) {
      const results = await pf.validate({
        tool: 'write',
        params: { path, content: 'API_KEY=abcdefghijklmnop1234567890' },
      });
      expect(results.find(r => r.rule === 'secrets-in-file-content')?.status, `path: ${path}`).toBe('pass');
    }
  });

  // FP2: Fictional dialogue in a JSONL eval fixture must not be flagged as a Cloudflare token.
  it('passes on fictional JSONL dialogue with a 40-char alphanumeric run (FP2)', async () => {
    // 200+ chars of plain English with at least one 40-char alphanumeric word run
    // (here, the phrase joins enough alphanumerics to potentially trigger the
    // old loose Cloudflare regex). No real secret present.
    const line = JSON.stringify({
      input: 'Tell me about your relationship with your sister and how it shapes you',
      output: 'My sister Annaleighbethanycaroldesireeevaforegoodness and I grew up close, sharing everything from secrets to dreams about the future together every single day.',
    });
    const results = await pf.validate({
      tool: 'write',
      params: { path: 'data/evals/relationship-patterns.jsonl', content: line },
    });
    expect(results.find(r => r.rule === 'secrets-in-file-content')?.status).toBe('pass');
  });

  it('passes on fixture / __fixtures__ / __mocks__ paths', async () => {
    const content = 'KEY_LIKE_THING=1234567890abcdefghij1234567890abcdefghij';
    for (const path of [
      'tests/__fixtures__/dialogue.txt',
      'src/__mocks__/api.ts',
      'fixtures/sample-config.yaml',
      'data/test/things.json',
      'data/fixtures/things.json',
    ]) {
      const results = await pf.validate({
        tool: 'write',
        params: { path, content },
      });
      expect(results.find(r => r.rule === 'secrets-in-file-content')?.status, `path: ${path}`).toBe('pass');
    }
  });

  it('passes on *.test.ts / *.spec.js paths', async () => {
    const content = 'const fakeToken = "abcdefghij1234567890abcdefghij1234567890";';
    for (const path of ['src/foo.test.ts', 'src/bar.spec.js', 'lib/baz.test.tsx']) {
      const results = await pf.validate({
        tool: 'write',
        params: { path, content },
      });
      expect(results.find(r => r.rule === 'secrets-in-file-content')?.status, `path: ${path}`).toBe('pass');
    }
  });

  // Negative test: real Cloudflare token in a non-whitelisted file with key
  // context must still FAIL.
  it('still fails on cloudflare_api_token with key context in config.json', async () => {
    const content = '{"cloudflare_api_token": "abcdefghij1234567890abcdefghij1234567890"}';
    const results = await pf.validate({
      tool: 'write',
      params: { path: 'config.json', content },
    });
    expect(results.find(r => r.rule === 'secrets-in-file-content')?.status).toBe('fail');
  });

  it('still fails on cf-prefixed token assignment in index.js', async () => {
    const content = 'const apiKey = "cf_token=abcdefghij1234567890abcdefghij1234567890";';
    const results = await pf.validate({
      tool: 'write',
      params: { path: 'index.js', content },
    });
    expect(results.find(r => r.rule === 'secrets-in-file-content')?.status).toBe('fail');
  });

  // Negative test for empty-value rule: even in a non-whitelisted file an
  // empty value is not a secret. Choice documented: empty value -> pass.
  // (There is nothing to leak, so the rule does not fire.)
  it('passes on api_key with empty value in non-whitelisted config.json', async () => {
    const content = '{"api_key": ""}';
    const results = await pf.validate({
      tool: 'write',
      params: { path: 'config.json', content },
    });
    expect(results.find(r => r.rule === 'secrets-in-file-content')?.status).toBe('pass');
  });

  it('passes on KEY= with empty value in non-whitelisted .env', async () => {
    const content = 'API_KEY=\nSECRET=\nPASSWORD=';
    const results = await pf.validate({
      tool: 'write',
      params: { path: '.env', content },
    });
    expect(results.find(r => r.rule === 'secrets-in-file-content')?.status).toBe('pass');
  });

  // Configurability: user can extend the ignore list via policyPack.
  it('respects policyPack.secretsChecks.additionalIgnoreGlobs', async () => {
    const { createPreflight } = await import('../src/index.js');
    const customPf = createPreflight({
      rules: ['secrets'],
      policyPack: {
        secretsChecks: {
          additionalIgnoreGlobs: ['**/golden/**'],
        },
      },
    });
    const results = await customPf.validate({
      tool: 'write',
      params: { path: 'data/golden/snapshot.json', content: 'API_KEY=abcdefghij1234567890abcd' },
    });
    expect(results.find(r => r.rule === 'secrets-in-file-content')?.status).toBe('pass');
  });
});

describe('secrets-in-bash-command', () => {
  it('warns on secret env var in command', async () => {
    const results = await pf.validate({
      tool: 'bash',
      params: { command: 'curl -H "Authorization: Bearer sk-abcdefghijklmnopqrstuvwxyz123456" https://api.example.com' },
    });
    expect(results.find(r => r.rule === 'secrets-in-bash-command')?.status).toBe('warn');
  });

  it('passes on safe command', async () => {
    const results = await pf.validate({
      tool: 'bash',
      params: { command: 'git status' },
    });
    expect(results.find(r => r.rule === 'secrets-in-bash-command')?.status).toBe('pass');
  });
});
