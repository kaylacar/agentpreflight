import { describe, it, expect, vi } from 'vitest';
import { createPreflight } from '../src/index.js';
import type { ToolCall } from '../src/types.js';

// Mock node:fs so OneDrive path checks work on any platform
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    accessSync(path: string, mode?: number) {
      // Simulate OneDrive folders existing on a Windows machine
      if (typeof path === 'string' && path.includes('OneDrive')) {
        return; // no throw = exists
      }
      return actual.accessSync(path, mode);
    },
  };
});

function makePreflight(platform: NodeJS.Platform = 'win32') {
  return createPreflight({
    rules: ['environment'],
    platform,
    homeDir: 'C:\\Users\\teche',
  });
}

describe('environment rules', () => {
  describe('onedrive-redirect', () => {
    it('warns when Desktop path should be OneDrive Desktop', async () => {
      const pf = makePreflight();
      const call: ToolCall = {
        tool: 'write_file',
        params: { path: 'C:\\Users\\teche\\Desktop\\file.txt' },
      };
      const results = await pf.validate(call);
      const rule = results.find((r) => r.rule === 'onedrive-redirect');
      expect(rule).toBeDefined();
      expect(rule!.status).toBe('warn');
      expect(rule!.suggestion).toContain('OneDrive');
    });

    it('warns for Documents path too', async () => {
      const pf = makePreflight();
      const call: ToolCall = {
        tool: 'write',
        params: { path: 'C:\\Users\\teche\\Documents\\notes.md' },
      };
      const results = await pf.validate(call);
      const rule = results.find((r) => r.rule === 'onedrive-redirect');
      expect(rule).toBeDefined();
      expect(rule!.status).toBe('warn');
      expect(rule!.suggestion).toContain('OneDrive\\Documents');
    });

    it('passes when path already includes OneDrive', async () => {
      const pf = makePreflight();
      const call: ToolCall = {
        tool: 'write_file',
        params: { path: 'C:\\Users\\teche\\OneDrive\\Desktop\\file.txt' },
      };
      const results = await pf.validate(call);
      const rule = results.find((r) => r.rule === 'onedrive-redirect');
      expect(rule).toBeDefined();
      expect(rule!.status).toBe('pass');
    });

    it('skips on non-Windows platforms', async () => {
      const pf = makePreflight('linux');
      const call: ToolCall = {
        tool: 'write_file',
        params: { path: '/home/user/Desktop/file.txt' },
      };
      const results = await pf.validate(call);
      const rule = results.find((r) => r.rule === 'onedrive-redirect');
      expect(rule).toBeDefined();
      expect(rule!.status).toBe('pass');
    });
  });

  describe('platform-path-sep', () => {
    it('warns on Unix-style absolute path on Windows', async () => {
      const pf = makePreflight();
      const call: ToolCall = {
        tool: 'read',
        params: { path: '/home/user/file.txt' },
      };
      const results = await pf.validate(call);
      const rule = results.find((r) => r.rule === 'platform-path-sep');
      expect(rule).toBeDefined();
      expect(rule!.status).toBe('warn');
    });

    it('warns on Windows backslashes on Unix', async () => {
      const pf = makePreflight('linux');
      const call: ToolCall = {
        tool: 'read',
        params: { path: 'C:\\Users\\file.txt' },
      };
      const results = await pf.validate(call);
      const rule = results.find((r) => r.rule === 'platform-path-sep');
      expect(rule).toBeDefined();
      expect(rule!.status).toBe('warn');
    });

    it('passes for correct Windows paths', async () => {
      const pf = makePreflight();
      const call: ToolCall = {
        tool: 'read',
        params: { path: 'C:\\Users\\teche\\file.txt' },
      };
      const results = await pf.validate(call);
      const rule = results.find((r) => r.rule === 'platform-path-sep');
      expect(rule).toBeDefined();
      expect(rule!.status).toBe('pass');
    });
  });

  describe('home-dir-resolution', () => {
    it('warns and resolves tilde paths', async () => {
      const pf = makePreflight();
      const call: ToolCall = {
        tool: 'read',
        params: { path: '~/config.json' },
      };
      const results = await pf.validate(call);
      const rule = results.find((r) => r.rule === 'home-dir-resolution');
      expect(rule).toBeDefined();
      expect(rule!.status).toBe('warn');
      expect(rule!.suggestion).toBe('C:\\Users\\teche/config.json');
    });
  });

  describe('devnull-platform', () => {
    it('warns on NUL usage on Unix', async () => {
      const pf = makePreflight('linux');
      const call: ToolCall = {
        tool: 'bash',
        params: { command: 'echo test > NUL' },
      };
      const results = await pf.validate(call);
      const rule = results.find((r) => r.rule === 'devnull-platform');
      expect(rule).toBeDefined();
      expect(rule!.status).toBe('warn');
      expect(rule!.suggestion).toContain('/dev/null');
    });
  });
});
