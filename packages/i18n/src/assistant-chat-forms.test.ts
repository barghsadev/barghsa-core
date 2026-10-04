import { expect, it } from 'vitest';
import { assistantChatFormText } from './assistant-chat-forms.js';
it('provides distinct bilingual feedback and stable placeholders', () => {
  for (const key of [
    'question',
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
