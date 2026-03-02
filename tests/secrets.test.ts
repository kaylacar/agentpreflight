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
