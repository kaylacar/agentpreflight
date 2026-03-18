import { describe, it, expect } from 'vitest';
import { createPreflight } from '../src/index.js';

const pf = createPreflight({ rules: ['release'] });

describe('release-claim-requires-evidence', () => {
  it('fails completion claim without evidence table', async () => {
    const results = await pf.validate({
      tool: 'final_response',
      params: { text: 'It is done and live now.' },
    });
    expect(results.find((r) => r.rule === 'release-claim-requires-evidence')?.status).toBe('fail');
  });

  it('passes completion claim with evidence table and pass/fail row', async () => {
    const results = await pf.validate({
      tool: 'final_response',
      params: {
        text: [
          'Site is fixed and live.',
          '',
          '| URL | Action | Expected | Actual | Pass/Fail |',
          '|---|---|---|---|---|',
          '| /start | Submit form | 200 | 200 | Pass |',
        ].join('\n'),
      },
    });
    expect(results.find((r) => r.rule === 'release-claim-requires-evidence')?.status).toBe('pass');
  });

  it('does not run when no completion claim exists', async () => {
    const results = await pf.validate({
      tool: 'final_response',
      params: { text: 'I am still debugging.' },
    });
    expect(results.length).toBe(0);
  });
});

