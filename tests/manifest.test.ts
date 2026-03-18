import { describe, it, expect } from 'vitest';
import { resolveRepo, resolvePath, loadManifest } from '../src/manifest.js';
import { createPreflight } from '../src/index.js';
import type { EnvManifest } from '../src/manifest.js';
import type { ToolCall } from '../src/types.js';
import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const testManifest: EnvManifest = {
  repos: {
    'machinepolicy.org': 'C:/Users/teche/machinepolicy.org',
    'rer': 'C:/Users/teche/OneDrive/Documents/GitHub/rer',
    'agents-txt': 'C:/Users/teche/OneDrive/Documents/GitHub/agents-txt',
  },
  paths: {
    desktop: 'C:/Users/teche/OneDrive/Desktop',
    github: 'C:/Users/teche/OneDrive/Documents/GitHub',
  },
};

describe('manifest', () => {
  describe('resolveRepo', () => {
    it('returns the local path for a known repo', () => {
      const result = resolveRepo(testManifest, 'machinepolicy.org');
      expect(result).toBe('C:/Users/teche/machinepolicy.org');
    });

    it('returns null for unknown repo', () => {
      const result = resolveRepo(testManifest, 'unknown-repo');
      expect(result).toBeNull();
    });
  });

  describe('resolvePath', () => {
    it('returns the local path for a known named path', () => {
      const result = resolvePath(testManifest, 'desktop');
      expect(result).toBe('C:/Users/teche/OneDrive/Desktop');
    });

    it('returns null for unknown named path', () => {
      const result = resolvePath(testManifest, 'unknown');
      expect(result).toBeNull();
    });
  });

  describe('loadManifest', () => {
    it('returns null when file does not exist', async () => {
      const result = await loadManifest('/nonexistent/path/.preflight-env.json');
      expect(result).toBeNull();
    });

    it('loads and parses a valid manifest file', async () => {
      const tmpPath = join(tmpdir(), `preflight-test-${Date.now()}.json`);
      await writeFile(tmpPath, JSON.stringify(testManifest), 'utf8');
      try {
        const result = await loadManifest(tmpPath);
        expect(result).not.toBeNull();
        expect(result!.repos['machinepolicy.org']).toBe('C:/Users/teche/machinepolicy.org');
        expect(result!.paths?.desktop).toBe('C:/Users/teche/OneDrive/Desktop');
      } finally {
        await unlink(tmpPath);
      }
    });

    it('throws on invalid manifest format', async () => {
      const tmpPath = join(tmpdir(), `preflight-test-bad-${Date.now()}.json`);
      await writeFile(tmpPath, JSON.stringify({ wrong: 'format' }), 'utf8');
      try {
        await expect(loadManifest(tmpPath)).rejects.toThrow('Invalid manifest format');
      } finally {
        await unlink(tmpPath);
      }
    });
  });
});

describe('repo-path-resolution rule', () => {
  function makePreflight() {
    return createPreflight({
      rules: ['environment'],
      platform: 'win32',
      homeDir: 'C:\\Users\\teche',
      manifest: testManifest,
    });
  }

  it('resolves a relative repo name to absolute path', async () => {
    const pf = makePreflight();
    const call: ToolCall = {
      tool: 'read',
      params: { path: 'machinepolicy.org/index.html' },
    };
    const results = await pf.validate(call);
    const rule = results.find((r) => r.rule === 'repo-path-resolution');
    expect(rule).toBeDefined();
    expect(rule!.status).toBe('warn');
    expect(rule!.suggestion).toBe('C:/Users/teche/machinepolicy.org/index.html');
  });

  it('resolves exact repo name with no trailing path', async () => {
    const pf = makePreflight();
    const call: ToolCall = {
      tool: 'glob',
      params: { path: 'rer' },
    };
    const results = await pf.validate(call);
    const rule = results.find((r) => r.rule === 'repo-path-resolution');
    expect(rule).toBeDefined();
    expect(rule!.status).toBe('warn');
    expect(rule!.suggestion).toBe('C:/Users/teche/OneDrive/Documents/GitHub/rer');
  });

  it('resolves named paths', async () => {
    const pf = makePreflight();
    const call: ToolCall = {
      tool: 'read',
      params: { path: 'desktop/notes.txt' },
    };
    const results = await pf.validate(call);
    const rule = results.find((r) => r.rule === 'repo-path-resolution');
    expect(rule).toBeDefined();
    expect(rule!.status).toBe('warn');
    expect(rule!.suggestion).toBe('C:/Users/teche/OneDrive/Desktop/notes.txt');
  });

  it('passes when path is already absolute', async () => {
    const pf = makePreflight();
    const call: ToolCall = {
      tool: 'read',
      params: { path: 'C:/Users/teche/machinepolicy.org/index.html' },
    };
    const results = await pf.validate(call);
    const rule = results.find((r) => r.rule === 'repo-path-resolution');
    expect(rule).toBeDefined();
    expect(rule!.status).toBe('pass');
  });

  it('passes when no manifest is provided', async () => {
    const missingManifestPath = join(tmpdir(), `preflight-missing-${Date.now()}.json`);
    const pf = createPreflight({
      rules: ['environment'],
      platform: 'win32',
      homeDir: 'C:\\Users\\teche',
      manifestPath: missingManifestPath,
    });
    const call: ToolCall = {
      tool: 'read',
      params: { path: 'machinepolicy.org/index.html' },
    };
    const results = await pf.validate(call);
    const rule = results.find((r) => r.rule === 'repo-path-resolution');
    expect(rule).toBeDefined();
    expect(rule!.status).toBe('pass');
  });
});
