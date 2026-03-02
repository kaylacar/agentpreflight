import { describe, it, expect } from 'vitest';
import { createPreflight } from '../src/index.js';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ToolCall } from '../src/types.js';

function makePreflight() {
  return createPreflight({
    rules: ['filesystem'],
    platform: 'win32',
  });
}

describe('filesystem rules', () => {
  let tempDir: string;

  const setup = () => {
    tempDir = mkdtempSync(join(tmpdir(), 'preflight-test-'));
    return tempDir;
  };

  const cleanup = () => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  };

  describe('parent-dir-exists', () => {
    it('fails when parent directory does not exist', async () => {
      const pf = makePreflight();
      const call: ToolCall = {
        tool: 'write_file',
        params: { path: '/nonexistent/directory/file.txt' },
      };
      const results = await pf.validate(call);
      const rule = results.find((r) => r.rule === 'parent-dir-exists');
      expect(rule).toBeDefined();
      expect(rule!.status).toBe('fail');
    });

    it('passes when parent directory exists', async () => {
      setup();
      const pf = makePreflight();
      const call: ToolCall = {
        tool: 'write_file',
        params: { path: join(tempDir, 'newfile.txt') },
      };
      const results = await pf.validate(call);
      const rule = results.find((r) => r.rule === 'parent-dir-exists');
      expect(rule).toBeDefined();
      expect(rule!.status).toBe('pass');
      cleanup();
    });
  });

  describe('file-exists-for-read', () => {
    it('fails when file does not exist', async () => {
      const pf = makePreflight();
      const call: ToolCall = {
        tool: 'read_file',
        params: { path: '/nonexistent/file.txt' },
      };
      const results = await pf.validate(call);
      const rule = results.find((r) => r.rule === 'file-exists-for-read');
      expect(rule).toBeDefined();
      expect(rule!.status).toBe('fail');
    });

    it('passes when file exists', async () => {
      setup();
      const filePath = join(tempDir, 'exists.txt');
      writeFileSync(filePath, 'hello');
      const pf = makePreflight();
      const call: ToolCall = {
        tool: 'read',
        params: { path: filePath },
      };
      const results = await pf.validate(call);
      const rule = results.find((r) => r.rule === 'file-exists-for-read');
      expect(rule).toBeDefined();
      expect(rule!.status).toBe('pass');
      cleanup();
    });
  });

  describe('write-permission', () => {
    it('passes for writable directories', async () => {
      setup();
      const pf = makePreflight();
      const call: ToolCall = {
        tool: 'write',
        params: { path: join(tempDir, 'newfile.txt') },
      };
      const results = await pf.validate(call);
      const rule = results.find((r) => r.rule === 'write-permission');
      expect(rule).toBeDefined();
      expect(rule!.status).toBe('pass');
      cleanup();
    });
  });

  describe('sensitive-file-write', () => {
    it('warns when writing to .env', async () => {
      setup();
      const pf = makePreflight();
      const call: ToolCall = {
        tool: 'write_file',
        params: { path: join(tempDir, '.env') },
      };
      const results = await pf.validate(call);
      const rule = results.find((r) => r.rule === 'sensitive-file-write');
      expect(rule).toBeDefined();
      expect(rule!.status).toBe('warn');
    });

    it('warns when writing to credentials.json', async () => {
      setup();
      const pf = makePreflight();
      const call: ToolCall = {
        tool: 'write',
        params: { path: join(tempDir, 'credentials.json') },
      };
      const results = await pf.validate(call);
      const rule = results.find((r) => r.rule === 'sensitive-file-write');
      expect(rule).toBeDefined();
      expect(rule!.status).toBe('warn');
    });

    it('passes for normal files', async () => {
      setup();
      const pf = makePreflight();
      const call: ToolCall = {
        tool: 'write',
        params: { path: join(tempDir, 'index.ts') },
      };
      const results = await pf.validate(call);
      const rule = results.find((r) => r.rule === 'sensitive-file-write');
      expect(rule).toBeDefined();
      expect(rule!.status).toBe('pass');
      cleanup();
    });
  });
});
