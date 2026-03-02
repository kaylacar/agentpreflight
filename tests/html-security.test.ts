import { describe, it, expect } from 'vitest';
import { createPreflight } from '../src/index.js';

const pf = createPreflight({ rules: ['html-security'] });

describe('html-security', () => {
  it('fails on eval() in JS file', async () => {
    const results = await pf.validate({
      tool: 'write',
      params: { path: 'app.js', content: 'const result = eval(userInput);' },
    });
    const rule = results.find(r => r.rule === 'html-security');
    expect(rule?.status).toBe('fail');
    expect(rule?.message).toContain('eval()');
  });

  it('warns on innerHTML assignment in HTML file', async () => {
    const results = await pf.validate({
      tool: 'write',
      params: { path: 'page.html', content: '<script>el.innerHTML = data;</script>' },
    });
    const rule = results.find(r => r.rule === 'html-security');
    expect(rule?.status).toBe('warn');
    expect(rule?.message).toContain('innerHTML');
  });

  it('warns on document.write() in JS file', async () => {
    const results = await pf.validate({
      tool: 'write',
      params: { path: 'legacy.js', content: 'document.write("<h1>Hello</h1>");' },
    });
    const rule = results.find(r => r.rule === 'html-security');
    expect(rule?.status).toBe('warn');
    expect(rule?.message).toContain('document.write()');
  });

  it('warns on new Function() in TS file', async () => {
    const results = await pf.validate({
      tool: 'write',
      params: { path: 'utils.ts', content: 'const fn = new Function("return 1");' },
    });
    const rule = results.find(r => r.rule === 'html-security');
    expect(rule?.status).toBe('warn');
    expect(rule?.message).toContain('new Function()');
  });

  it('warns on outerHTML assignment', async () => {
    const results = await pf.validate({
      tool: 'write',
      params: { path: 'component.tsx', content: 'element.outerHTML = unsafeString;' },
    });
    const rule = results.find(r => r.rule === 'html-security');
    expect(rule?.status).toBe('warn');
    expect(rule?.message).toContain('outerHTML');
  });

  it('passes on safe HTML/JS content', async () => {
    const results = await pf.validate({
      tool: 'write',
      params: { path: 'app.ts', content: 'export function hello() { return "world"; }' },
    });
    const rule = results.find(r => r.rule === 'html-security');
    expect(rule?.status).toBe('pass');
  });

  it('skips non-HTML/JS files', async () => {
    const results = await pf.validate({
      tool: 'write',
      params: { path: 'data.json', content: '{"eval": true}' },
    });
    expect(results.find(r => r.rule === 'html-security')).toBeUndefined();
  });

  it('skips when no content provided', async () => {
    const results = await pf.validate({
      tool: 'write',
      params: { path: 'app.js' },
    });
    expect(results.find(r => r.rule === 'html-security')).toBeUndefined();
  });

  it('works with .vue files', async () => {
    const results = await pf.validate({
      tool: 'write',
      params: { path: 'App.vue', content: '<script>el.innerHTML = data</script>' },
    });
    expect(results.find(r => r.rule === 'html-security')?.status).toBe('warn');
  });

  it('works with .svelte files', async () => {
    const results = await pf.validate({
      tool: 'write',
      params: { path: 'Component.svelte', content: 'eval("bad")' },
    });
    expect(results.find(r => r.rule === 'html-security')?.status).toBe('fail');
  });
});
