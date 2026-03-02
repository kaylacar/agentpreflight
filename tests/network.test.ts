import { describe, it, expect } from 'vitest';
import { createPreflight } from '../src/index.js';

const pf = createPreflight({ rules: ['network'] });

describe('network-dangerous-protocol', () => {
  it('fails on file:// URL', async () => {
    const results = await pf.validate({ tool: 'web_fetch', params: { url: 'file:///etc/passwd' } });
    expect(results.find(r => r.rule === 'network-dangerous-protocol')?.status).toBe('fail');
  });

  it('fails on javascript:// URL', async () => {
    const results = await pf.validate({ tool: 'WebFetch', params: { url: 'javascript:alert(1)' } });
    expect(results.find(r => r.rule === 'network-dangerous-protocol')?.status).toBe('fail');
  });

  it('passes on https URL', async () => {
    const results = await pf.validate({ tool: 'web_fetch', params: { url: 'https://example.com' } });
    expect(results.find(r => r.rule === 'network-dangerous-protocol')?.status).toBe('pass');
  });
});

describe('network-internal-access', () => {
  it('warns on localhost', async () => {
    const results = await pf.validate({ tool: 'web_fetch', params: { url: 'http://localhost:3000/api' } });
    expect(results.find(r => r.rule === 'network-internal-access')?.status).toBe('warn');
  });

  it('warns on 127.0.0.1', async () => {
    const results = await pf.validate({ tool: 'fetch', params: { url: 'http://127.0.0.1/secret' } });
    expect(results.find(r => r.rule === 'network-internal-access')?.status).toBe('warn');
  });

  it('warns on 192.168.x.x', async () => {
    const results = await pf.validate({ tool: 'web_fetch', params: { url: 'http://192.168.1.1/admin' } });
    expect(results.find(r => r.rule === 'network-internal-access')?.status).toBe('warn');
  });

  it('passes on public IP', async () => {
    const results = await pf.validate({ tool: 'web_fetch', params: { url: 'https://api.github.com' } });
    expect(results.find(r => r.rule === 'network-internal-access')?.status).toBe('pass');
  });
});

describe('network-http-not-https', () => {
  it('warns on plain http', async () => {
    const results = await pf.validate({ tool: 'web_fetch', params: { url: 'http://example.com' } });
    expect(results.find(r => r.rule === 'network-http-not-https')?.status).toBe('warn');
  });

  it('passes on https', async () => {
    const results = await pf.validate({ tool: 'web_fetch', params: { url: 'https://example.com' } });
    expect(results.find(r => r.rule === 'network-http-not-https')?.status).toBe('pass');
  });
});

describe('network-secret-in-headers', () => {
  it('warns on bearer token in Authorization header', async () => {
    const results = await pf.validate({
      tool: 'web_fetch',
      params: {
        url: 'https://example.com',
        headers: { Authorization: 'Bearer sk-abcdefghijklmnopqrstuvwxyz1234567890' },
      },
    });
    expect(results.find(r => r.rule === 'network-secret-in-headers')?.status).toBe('warn');
  });

  it('passes on non-secret headers', async () => {
    const results = await pf.validate({
      tool: 'web_fetch',
      params: {
        url: 'https://example.com',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      },
    });
    expect(results.find(r => r.rule === 'network-secret-in-headers')?.status).toBe('pass');
  });
});
