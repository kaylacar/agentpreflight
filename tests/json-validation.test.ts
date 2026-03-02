import { describe, it, expect } from 'vitest';
import { createPreflight } from '../src/index.js';

const pf = createPreflight({ rules: ['json-validation'] });

describe('json-syntax-validation', () => {
  it('fails on invalid JSON written to .json file', async () => {
    const results = await pf.validate({
      tool: 'write',
      params: { path: 'config.json', content: '{invalid json' },
    });
    expect(results.find(r => r.rule === 'json-syntax-validation')?.status).toBe('fail');
  });

  it('fails on trailing comma', async () => {
    const results = await pf.validate({
      tool: 'write_file',
      params: { path: 'data.json', content: '{"name": "test",}' },
    });
    expect(results.find(r => r.rule === 'json-syntax-validation')?.status).toBe('fail');
  });

  it('fails on truncated JSON', async () => {
    const results = await pf.validate({
      tool: 'write',
      params: { path: 'package.json', content: '{"name": "test"' },
    });
    expect(results.find(r => r.rule === 'json-syntax-validation')?.status).toBe('fail');
  });

  it('passes on valid JSON', async () => {
    const results = await pf.validate({
      tool: 'write',
      params: { path: 'package.json', content: '{"name":"test","version":"1.0.0"}' },
    });
    expect(results.find(r => r.rule === 'json-syntax-validation')?.status).toBe('pass');
  });

  it('passes on valid JSON array', async () => {
    const results = await pf.validate({
      tool: 'write',
      params: { path: 'data.json', content: '[1, 2, 3]' },
    });
    expect(results.find(r => r.rule === 'json-syntax-validation')?.status).toBe('pass');
  });

  it('skips non-.json files', async () => {
    const results = await pf.validate({
      tool: 'write',
      params: { path: 'index.ts', content: 'not json at all' },
    });
    expect(results.find(r => r.rule === 'json-syntax-validation')).toBeUndefined();
  });

  it('passes when no content is provided', async () => {
    const results = await pf.validate({
      tool: 'write',
      params: { path: 'data.json' },
    });
    expect(results.find(r => r.rule === 'json-syntax-validation')?.status).toBe('pass');
  });
});
