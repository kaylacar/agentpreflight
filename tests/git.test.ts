import { describe, it, expect } from 'vitest';
import { createPreflight } from '../src/index.js';
import type { ToolCall } from '../src/types.js';

function mockExec(responses: Record<string, string>) {
  return async (cmd: string, args: string[]): Promise<string> => {
    const key = `${cmd} ${args.join(' ')}`;
    for (const [pattern, response] of Object.entries(responses)) {
      if (key.includes(pattern)) return response;
    }
    throw new Error(`Unmocked command: ${key}`);
  };
}

function makePreflight(exec?: (cmd: string, args: string[]) => Promise<string>) {
  return createPreflight({
    rules: ['git'],
    platform: 'win32',
    exec,
  });
}

describe('git rules', () => {
  describe('force-push-protection', () => {
    it('warns on force push', async () => {
      const pf = makePreflight();
      const call: ToolCall = {
        tool: 'bash',
        params: { command: 'git push --force origin feature' },
      };
      const results = await pf.validate(call);
      const rule = results.find((r) => r.rule === 'force-push-protection');
      expect(rule).toBeDefined();
      expect(rule!.status).toBe('warn');
    });

    it('fails on force push to main', async () => {
      const pf = makePreflight();
      const call: ToolCall = {
        tool: 'bash',
        params: { command: 'git push --force origin main' },
      };
      const results = await pf.validate(call);
      const rule = results.find((r) => r.rule === 'force-push-protection');
      expect(rule).toBeDefined();
      expect(rule!.status).toBe('fail');
    });

    it('passes for --force-with-lease', async () => {
      const pf = makePreflight();
      const call: ToolCall = {
        tool: 'bash',
        params: { command: 'git push --force-with-lease origin feature' },
      };
      const results = await pf.validate(call);
      const rule = results.find((r) => r.rule === 'force-push-protection');
      expect(rule).toBeDefined();
      expect(rule!.status).toBe('pass');
    });

    it('passes for normal push', async () => {
      const pf = makePreflight();
      const call: ToolCall = {
        tool: 'bash',
        params: { command: 'git push origin feature' },
      };
      const results = await pf.validate(call);
      const rule = results.find((r) => r.rule === 'force-push-protection');
      expect(rule).toBeDefined();
      expect(rule!.status).toBe('pass');
    });
  });

  describe('push-upstream-check', () => {
    it('passes when setting upstream', async () => {
      const pf = makePreflight();
      const call: ToolCall = {
        tool: 'bash',
        params: { command: 'git push -u origin feature' },
      };
      const results = await pf.validate(call);
      const rule = results.find((r) => r.rule === 'push-upstream-check');
      expect(rule).toBeDefined();
      expect(rule!.status).toBe('pass');
    });

    it('warns when no upstream exists', async () => {
      const exec = mockExec({
        'rev-parse --abbrev-ref HEAD': 'feature-branch',
      });
      // Override to throw on upstream check
      const customExec = async (cmd: string, args: string[]): Promise<string> => {
        const key = args.join(' ');
        if (key.includes('rev-parse --abbrev-ref HEAD')) return 'feature-branch';
        if (key.includes('@{upstream}')) throw new Error('no upstream');
        return '';
      };
      const pf = makePreflight(customExec);
      const call: ToolCall = {
        tool: 'bash',
        params: { command: 'git push origin feature-branch' },
      };
      const results = await pf.validate(call);
      const rule = results.find((r) => r.rule === 'push-upstream-check');
      expect(rule).toBeDefined();
      expect(rule!.status).toBe('warn');
      expect(rule!.message).toContain('No upstream');
    });

    it('fails when branch has diverged', async () => {
      const exec = async (cmd: string, args: string[]): Promise<string> => {
        const key = args.join(' ');
        if (key.includes('rev-parse --abbrev-ref HEAD')) return 'main';
        if (key.includes('@{upstream}')) return 'origin/main';
        if (key.includes('status --porcelain -b')) return '## main...origin/main [diverged]';
        return '';
      };
      const pf = makePreflight(exec);
      const call: ToolCall = {
        tool: 'bash',
        params: { command: 'git push origin main' },
      };
      const results = await pf.validate(call);
      const rule = results.find((r) => r.rule === 'push-upstream-check');
      expect(rule).toBeDefined();
      expect(rule!.status).toBe('fail');
      expect(rule!.message).toContain('diverged');
    });

    it('warns when behind upstream', async () => {
      const exec = async (cmd: string, args: string[]): Promise<string> => {
        const key = args.join(' ');
        if (key.includes('rev-parse --abbrev-ref HEAD')) return 'main';
        if (key.includes('@{upstream}')) return 'origin/main';
        if (key.includes('status --porcelain -b')) return '## main...origin/main [behind 3]';
        return '';
      };
      const pf = makePreflight(exec);
      const call: ToolCall = {
        tool: 'bash',
        params: { command: 'git push' },
      };
      const results = await pf.validate(call);
      const rule = results.find((r) => r.rule === 'push-upstream-check');
      expect(rule).toBeDefined();
      expect(rule!.status).toBe('warn');
      expect(rule!.message).toContain('behind');
    });
  });

  describe('staging-verification', () => {
    it('fails when nothing is staged', async () => {
      const exec = async (cmd: string, args: string[]): Promise<string> => {
        if (args.includes('--cached')) return '';
        return '';
      };
      const pf = makePreflight(exec);
      const call: ToolCall = {
        tool: 'bash',
        params: { command: 'git commit -m "test"' },
      };
      const results = await pf.validate(call);
      const rule = results.find((r) => r.rule === 'staging-verification');
      expect(rule).toBeDefined();
      expect(rule!.status).toBe('fail');
      expect(rule!.message).toContain('Nothing is staged');
    });

    it('warns when sensitive files are staged', async () => {
      const exec = async (cmd: string, args: string[]): Promise<string> => {
        if (args.includes('--cached')) return '.env\nsrc/index.ts';
        return '';
      };
      const pf = makePreflight(exec);
      const call: ToolCall = {
        tool: 'bash',
        params: { command: 'git commit -m "add config"' },
      };
      const results = await pf.validate(call);
      const rule = results.find((r) => r.rule === 'staging-verification');
      expect(rule).toBeDefined();
      expect(rule!.status).toBe('warn');
      expect(rule!.message).toContain('.env');
    });

    it('passes when normal files are staged', async () => {
      const exec = async (cmd: string, args: string[]): Promise<string> => {
        if (args.includes('--cached')) return 'src/index.ts\nsrc/utils.ts';
        return '';
      };
      const pf = makePreflight(exec);
      const call: ToolCall = {
        tool: 'bash',
        params: { command: 'git commit -m "update code"' },
      };
      const results = await pf.validate(call);
      const rule = results.find((r) => r.rule === 'staging-verification');
      expect(rule).toBeDefined();
      expect(rule!.status).toBe('pass');
    });
  });

  describe('branch-protection', () => {
    it('warns on destructive operations on main', async () => {
      const exec = async (cmd: string, args: string[]): Promise<string> => {
        if (args.includes('HEAD')) return 'main';
        return '';
      };
      const pf = makePreflight(exec);
      const call: ToolCall = {
        tool: 'bash',
        params: { command: 'git reset --hard HEAD~1' },
      };
      const results = await pf.validate(call);
      const rule = results.find((r) => r.rule === 'branch-protection');
      expect(rule).toBeDefined();
      expect(rule!.status).toBe('warn');
      expect(rule!.message).toContain('main');
    });

    it('passes on feature branches', async () => {
      const exec = async (cmd: string, args: string[]): Promise<string> => {
        if (args.includes('HEAD')) return 'feature/new-thing';
        return '';
      };
      const pf = makePreflight(exec);
      const call: ToolCall = {
        tool: 'bash',
        params: { command: 'git reset --hard HEAD~1' },
      };
      const results = await pf.validate(call);
      const rule = results.find((r) => r.rule === 'branch-protection');
      expect(rule).toBeDefined();
      expect(rule!.status).toBe('pass');
    });
  });

  describe('no-verify-detection', () => {
    it('warns on --no-verify', async () => {
      const pf = makePreflight();
      const call: ToolCall = {
        tool: 'bash',
        params: { command: 'git commit --no-verify -m "skip hooks"' },
      };
      const results = await pf.validate(call);
      const rule = results.find((r) => r.rule === 'no-verify-detection');
      expect(rule).toBeDefined();
      expect(rule!.status).toBe('warn');
    });
  });
});
