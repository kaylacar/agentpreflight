import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createPreflight } from '../src/index.js';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ToolCall } from '../src/types.js';

function makePreflight() {
  return createPreflight({
    rules: ['naming'],
    platform: 'win32',
  });
}

describe('naming rules', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'preflight-naming-'));
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('file-naming-convention', () => {
    it('warns when new file breaks kebab-case convention', async () => {
      // Create kebab-case siblings
      writeFileSync(join(tempDir, 'my-module.ts'), '');
      writeFileSync(join(tempDir, 'some-utils.ts'), '');
      writeFileSync(join(tempDir, 'test-helper.ts'), '');
      writeFileSync(join(tempDir, 'data-loader.ts'), '');

      const pf = makePreflight();
      const call: ToolCall = {
        tool: 'write_file',
        params: { path: join(tempDir, 'myNewFile.ts') },
      };
      const results = await pf.validate(call);
      const rule = results.find((r) => r.rule === 'file-naming-convention');
      expect(rule).toBeDefined();
      expect(rule!.status).toBe('warn');
      expect(rule!.message).toContain('camelCase');
      expect(rule!.message).toContain('kebab-case');
    });

    it('passes when new file matches convention', async () => {
      writeFileSync(join(tempDir, 'my-module.ts'), '');
      writeFileSync(join(tempDir, 'some-utils.ts'), '');
      writeFileSync(join(tempDir, 'test-helper.ts'), '');
      writeFileSync(join(tempDir, 'data-loader.ts'), '');

      const pf = makePreflight();
      const call: ToolCall = {
        tool: 'write_file',
        params: { path: join(tempDir, 'new-module.ts') },
      };
      const results = await pf.validate(call);
      const rule = results.find((r) => r.rule === 'file-naming-convention');
      expect(rule).toBeDefined();
      expect(rule!.status).toBe('pass');
    });

    it('passes when too few siblings to determine convention', async () => {
      writeFileSync(join(tempDir, 'one.ts'), '');

      const pf = makePreflight();
      const call: ToolCall = {
        tool: 'write_file',
        params: { path: join(tempDir, 'two.ts') },
      };
      const results = await pf.validate(call);
      const rule = results.find((r) => r.rule === 'file-naming-convention');
      expect(rule).toBeDefined();
      expect(rule!.status).toBe('pass');
    });
  });

  describe('naming-mistakes', () => {
    it('warns on duplicate extensions', async () => {
      const pf = makePreflight();
      const call: ToolCall = {
        tool: 'write_file',
        params: { path: join(tempDir, 'file.ts.ts') },
      };
      const results = await pf.validate(call);
      const rule = results.find((r) => r.rule === 'naming-mistakes');
      expect(rule).toBeDefined();
      expect(rule!.status).toBe('warn');
      expect(rule!.suggestion).toBe('file.ts');
    });

    it('warns on spaces in code project filenames', async () => {
      const pf = makePreflight();
      const call: ToolCall = {
        tool: 'write',
        params: { path: join(tempDir, 'my file.ts') },
      };
      const results = await pf.validate(call);
      const rule = results.find((r) => r.rule === 'naming-mistakes');
      expect(rule).toBeDefined();
      expect(rule!.status).toBe('warn');
      expect(rule!.suggestion).toBe('my-file.ts');
    });

    it('passes for clean filenames', async () => {
      const pf = makePreflight();
      const call: ToolCall = {
        tool: 'write',
        params: { path: join(tempDir, 'clean-file.ts') },
      };
      const results = await pf.validate(call);
      const rule = results.find((r) => r.rule === 'naming-mistakes');
      expect(rule).toBeDefined();
      expect(rule!.status).toBe('pass');
    });
  });
});
