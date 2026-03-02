import { describe, it, expect } from 'vitest';
import { createPreflight } from '../src/index.js';

const pf = createPreflight({ rules: ['yaml-validation'] });

describe('yaml-syntax-validation', () => {
  it('fails on tab indentation', async () => {
    const results = await pf.validate({
      tool: 'write',
      params: { path: 'config.yml', content: 'name: test\n\tkey: value' },
    });
    const rule = results.find(r => r.rule === 'yaml-syntax-validation');
    expect(rule?.status).toBe('fail');
    expect(rule?.message).toContain('Tab');
  });

  it('fails on unclosed single quote', async () => {
    const results = await pf.validate({
      tool: 'write',
      params: { path: 'config.yaml', content: "name: 'unclosed" },
    });
    expect(results.find(r => r.rule === 'yaml-syntax-validation')?.status).toBe('fail');
  });

  it('fails on unclosed double quote', async () => {
    const results = await pf.validate({
      tool: 'write',
      params: { path: 'config.yml', content: 'name: "unclosed' },
    });
    expect(results.find(r => r.rule === 'yaml-syntax-validation')?.status).toBe('fail');
  });

  it('fails on duplicate top-level keys', async () => {
    const results = await pf.validate({
      tool: 'write',
      params: { path: 'action.yml', content: 'name: first\nversion: 1\nname: second' },
    });
    const rule = results.find(r => r.rule === 'yaml-syntax-validation');
    expect(rule?.status).toBe('fail');
    expect(rule?.message).toContain('Duplicate');
    expect(rule?.message).toContain('name');
  });

  it('passes on valid YAML', async () => {
    const results = await pf.validate({
      tool: 'write',
      params: {
        path: 'docker-compose.yml',
        content: 'version: "3"\nservices:\n  web:\n    image: nginx\n    ports:\n      - "80:80"',
      },
    });
    expect(results.find(r => r.rule === 'yaml-syntax-validation')?.status).toBe('pass');
  });

  it('passes when no content is provided', async () => {
    const results = await pf.validate({
      tool: 'write',
      params: { path: 'empty.yaml' },
    });
    expect(results.find(r => r.rule === 'yaml-syntax-validation')?.status).toBe('pass');
  });

  it('skips non-YAML files', async () => {
    const results = await pf.validate({
      tool: 'write',
      params: { path: 'config.json', content: '\tbroken' },
    });
    expect(results.find(r => r.rule === 'yaml-syntax-validation')).toBeUndefined();
  });

  it('works with .yaml extension', async () => {
    const results = await pf.validate({
      tool: 'write',
      params: { path: 'config.yaml', content: '\tbad: indent' },
    });
    expect(results.find(r => r.rule === 'yaml-syntax-validation')?.status).toBe('fail');
  });
});
