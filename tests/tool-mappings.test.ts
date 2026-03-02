import { describe, it, expect } from 'vitest';
import { createPreflight, createToolMatcher, DEFAULT_TOOL_MAPPINGS } from '../src/index.js';

describe('ToolMatcher', () => {
  it('default matcher recognizes built-in write tools', () => {
    const tools = createToolMatcher();
    expect(tools.isWrite('write')).toBe(true);
    expect(tools.isWrite('Write')).toBe(true);
    expect(tools.isWrite('write_file')).toBe(true);
    expect(tools.isWrite('edit')).toBe(true);
    expect(tools.isWrite('notebookedit')).toBe(true);
    expect(tools.isWrite('read')).toBe(false);
  });

  it('default matcher recognizes read tools', () => {
    const tools = createToolMatcher();
    expect(tools.isRead('read')).toBe(true);
    expect(tools.isRead('Read')).toBe(true);
    expect(tools.isRead('read_file')).toBe(true);
    expect(tools.isRead('glob')).toBe(true);
    expect(tools.isRead('write')).toBe(false);
  });

  it('isFile includes both read and write tools', () => {
    const tools = createToolMatcher();
    expect(tools.isFile('write')).toBe(true);
    expect(tools.isFile('read')).toBe(true);
    expect(tools.isFile('glob')).toBe(true);
    expect(tools.isFile('bash')).toBe(false);
  });

  it('default matcher recognizes bash tools', () => {
    const tools = createToolMatcher();
    expect(tools.isBash('bash')).toBe(true);
    expect(tools.isBash('Bash')).toBe(true);
    expect(tools.isBash('shell')).toBe(true);
    expect(tools.isBash('execute')).toBe(true);
    expect(tools.isBash('write')).toBe(false);
  });

  it('default matcher recognizes network tools', () => {
    const tools = createToolMatcher();
    expect(tools.isNetwork('web_fetch')).toBe(true);
    expect(tools.isNetwork('WebFetch')).toBe(true);
    expect(tools.isNetwork('fetch')).toBe(true);
    expect(tools.isNetwork('curl')).toBe(true);
    expect(tools.isNetwork('bash')).toBe(false);
  });

  it('custom mappings extend defaults', () => {
    const tools = createToolMatcher({
      write: ['my_custom_write_tool', 'SaveFile'],
      bash: ['RunShell'],
    });
    // Custom tools work
    expect(tools.isWrite('my_custom_write_tool')).toBe(true);
    expect(tools.isWrite('SaveFile')).toBe(true);
    expect(tools.isBash('RunShell')).toBe(true);
    // Built-in still work
    expect(tools.isWrite('write')).toBe(true);
    expect(tools.isBash('bash')).toBe(true);
  });

  it('custom mappings are case-insensitive', () => {
    const tools = createToolMatcher({ write: ['MyTool'] });
    expect(tools.isWrite('mytool')).toBe(true);
    expect(tools.isWrite('MYTOOL')).toBe(true);
    expect(tools.isWrite('MyTool')).toBe(true);
  });
});

describe('toolMappings option in createPreflight', () => {
  it('custom write tool triggers filesystem rules', async () => {
    const pf = createPreflight({
      rules: ['filesystem'],
      toolMappings: { write: ['custom_save'] },
    });
    const results = await pf.validate({
      tool: 'custom_save',
      params: { path: '/nonexistent/dir/file.txt' },
    });
    const rule = results.find(r => r.rule === 'parent-dir-exists');
    expect(rule).toBeDefined();
    expect(rule!.status).toBe('fail');
  });

  it('custom bash tool triggers git rules', async () => {
    const pf = createPreflight({
      rules: ['git'],
      toolMappings: { bash: ['terminal'] },
    });
    const results = await pf.validate({
      tool: 'terminal',
      params: { command: 'git push --force origin main' },
    });
    const rule = results.find(r => r.rule === 'force-push-protection');
    expect(rule).toBeDefined();
    expect(rule!.status).toBe('fail');
  });

  it('custom network tool triggers network rules', async () => {
    const pf = createPreflight({
      rules: ['network'],
      toolMappings: { network: ['api_call'] },
    });
    const results = await pf.validate({
      tool: 'api_call',
      params: { url: 'file:///etc/passwd' },
    });
    const rule = results.find(r => r.rule === 'network-dangerous-protocol');
    expect(rule).toBeDefined();
    expect(rule!.status).toBe('fail');
  });

  it('unknown tool name is not matched by default', async () => {
    const pf = createPreflight({ rules: ['filesystem'] });
    const results = await pf.validate({
      tool: 'my_totally_custom_tool',
      params: { path: '/nonexistent/dir/file.txt' },
    });
    // No rules should match since the tool name isn't recognized
    expect(results.length).toBe(0);
  });
});

describe('DEFAULT_TOOL_MAPPINGS', () => {
  it('exports the default mappings', () => {
    expect(DEFAULT_TOOL_MAPPINGS.write).toContain('write');
    expect(DEFAULT_TOOL_MAPPINGS.write).toContain('write_file');
    expect(DEFAULT_TOOL_MAPPINGS.read).toContain('read');
    expect(DEFAULT_TOOL_MAPPINGS.bash).toContain('bash');
    expect(DEFAULT_TOOL_MAPPINGS.network).toContain('web_fetch');
  });
});
