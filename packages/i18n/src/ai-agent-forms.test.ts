import { expect, it } from 'vitest';
import { aiAgentFormText } from './ai-agent-forms.js';
for (const locale of ['fa', 'en'] as const)
  it(`AI agent and slot feedback is translated in ${locale}`, () => {
    const fields: Parameters<typeof aiAgentFormText>[0][] = [
      'title',
      'description',
      'modelId',
      'systemPrompt',
      'temperature',
      'maxTokens',
      'linkMode',
      'enabled',
      'kbIds',
      'policyIds',
      'kbGroupIds',
      'policyGroupIds',
      'agentId',
      'unavailable',
      'invalid',
      'changed',
      'uncertain',
      'reset',
    ];
    for (const field of fields) {
      expect(aiAgentFormText(field, locale).trim()).not.toBe('');
      expect(aiAgentFormText(field, locale)).not.toBe(
        aiAgentFormText(field, locale === 'fa' ? 'en' : 'fa')
      );
    }
  });
