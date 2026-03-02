import { describe, it, expect } from 'vitest';
import { createPreflight } from '../src/index.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const cwd = tmpdir();
const pf = createPreflight({ rules: ['scope'], cwd });

describe('scope-path-traversal', () => {
  it('fails when path escapes cwd', async () => {
    const results = await pf.validate({
      tool: 'write',
      params: { path: join(cwd, '../../etc/passwd') },
    });
    expect(results.find(r => r.rule === 'scope-path-traversal')?.status).toBe('fail');
  });

  it('passes when path is within cwd', async () => {
    const results = await pf.validate({
      tool: 'write',
      params: { path: join(cwd, 'src/index.ts') },
    });
    expect(results.find(r => r.rule === 'scope-path-traversal')?.status).toBe('pass');
  });
});

describe('scope-system-dir-write', () => {
  it('fails on write to /etc/', async () => {
    const results = await pf.validate({
      tool: 'write',
      params: { path: '/etc/hosts' },
    });
    expect(results.find(r => r.rule === 'scope-system-dir-write')?.status).toBe('fail');
  });

  it('fails on write to /usr/bin/', async () => {
    const results = await pf.validate({
      tool: 'write',
      params: { path: '/usr/bin/malicious' },
    });
    expect(results.find(r => r.rule === 'scope-system-dir-write')?.status).toBe('fail');
  });

  it('passes on write to temp dir', async () => {
    const results = await pf.validate({
      tool: 'write',
      params: { path: join(cwd, 'output.txt') },
    });
    expect(results.find(r => r.rule === 'scope-system-dir-write')?.status).toBe('pass');
  });
});
