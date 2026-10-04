import { expect, it } from 'vitest';
import { assistantChatFormText } from './assistant-chat-forms.js';
it('provides bilingual metadata and every known rule outcome', () => {
  for (const key of [
    'tokenParts',
    'tokenTotal',
    'tokenTotalHelp',
    'priority',
    'unrecorded',
    'noSources',
    'noPolicies',
    'rulesUnrecorded',
    'rule.topics',
    'rule.actions',
    'rule.inputFilter',
    'rule.outputFilter',
    'rule.scopes',
    'rule.tone',
    'rule.language',
    'rule.maxLength',
    'rule.requireSources',
    'rule.format',
    'rule.rateLimit',
    'outcome.matched',
    'outcome.passed',
    'outcome.applied',
    'outcome.overridden',
    'outcome.blocked',
  ] as const) {
    expect(assistantChatFormText(key, 'en')).not.toBe(assistantChatFormText(key, 'fa'));
    expect(assistantChatFormText(key, 'fa')).toMatch(/[آ-ی]/);
  }
});
it('provides distinct bilingual feedback and stable placeholders', () => {
  for (const key of [
    'question',
    'yourMessage',
    'assistantMessage',
    'accountMessage',
    'sentAt',
    'receivedAt',
    'message',
    'agentId',
    'slotKey',
    'unavailable',
    'invalid',
    'edit',
    'retryHelp',
    'denied',
    'wait',
    'applied',
    'blocked',
    'milliseconds',
  ] as const) {
    expect(assistantChatFormText(key, 'en')).not.toBe(assistantChatFormText(key, 'fa'));
    expect(assistantChatFormText(key, 'fa')).toMatch(/[آ-ی]/);
  }
  for (const locale of ['fa', 'en'] as const) {
    expect(assistantChatFormText('wait', locale)).toContain('{seconds}');
    expect(assistantChatFormText('milliseconds', locale)).toContain('{count}');
  }
});
