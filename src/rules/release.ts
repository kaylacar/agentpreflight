import type { Rule, ToolCall, ValidationResult } from '../types.js';

const RESPONSE_TOOLS = new Set([
  'final_response',
  'assistant_response',
  'assistant_message',
  'respond',
  'response',
  'final',
  'message',
]);

const CLAIM_KEYWORDS = /\b(done|fixed|live|resolved|working|completed)\b/i;
const EVIDENCE_HEADER = /\|\s*url\s*\|\s*action\s*\|\s*expected\s*\|\s*actual\s*\|\s*pass\/fail\s*\|/i;
const EVIDENCE_ROW = /^\|.*\|.*\|.*\|.*\|\s*(pass|fail)\s*\|/gim;

function getResponseText(call: ToolCall): string {
  const candidates = [
    call.params.text,
    call.params.message,
    call.params.content,
    call.params.output,
    call.params.response,
    call.params.final,
  ];

  for (const value of candidates) {
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }
  return '';
}

const completionClaimRequiresEvidence: Rule = {
  name: 'release-claim-requires-evidence',
  matches(call) {
    const tool = call.tool.toLowerCase();
    const text = getResponseText(call);
    const isResponseLike = RESPONSE_TOOLS.has(tool) || tool.includes('response') || tool.includes('message');
    return isResponseLike && CLAIM_KEYWORDS.test(text);
  },
  async validate(call): Promise<ValidationResult> {
    const text = getResponseText(call);
    const hasHeader = EVIDENCE_HEADER.test(text);
    const rows = text.match(EVIDENCE_ROW) ?? [];
    const hasRows = rows.length > 0;

    if (!hasHeader || !hasRows) {
      return {
        status: 'fail',
        rule: 'release-claim-requires-evidence',
        message: 'Completion claim found without required evidence table.',
        suggestion: 'Include a table: | URL | Action | Expected | Actual | Pass/Fail | with at least one Pass/Fail row.',
      };
    }

    return {
      status: 'pass',
      rule: 'release-claim-requires-evidence',
      message: 'Completion claim includes evidence table.',
    };
  },
};

export const releaseRules: Rule[] = [completionClaimRequiresEvidence];

