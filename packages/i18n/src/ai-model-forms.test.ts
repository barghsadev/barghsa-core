import { expect, it } from 'vitest';
import { aiModelFormText } from './ai-model-forms.js';
for (const locale of ['fa', 'en'] as const)
  it(`AI model and budget feedback is translated in ${locale}`, () => {
    const fields: Parameters<typeof aiModelFormText>[0][] = [
      'list',
      'title',
      'providerType',
      'baseUrl',
      'modelName',
      'maxTokens',
      'temperature',
      'apiTokenMessage',
      'tokenChoice',
      'monthlyTokenLimit',
      'monthlyCostUsd',
      'inputPriceUsd',
      'outputPriceUsd',
      'unavailable',
      'invalid',
      'changed',
      'uncertain',
      'reset',
    ];
    for (const field of fields) {
      expect(aiModelFormText(field, locale).trim()).not.toBe('');
      expect(aiModelFormText(field, locale)).not.toBe(
        aiModelFormText(field, locale === 'fa' ? 'en' : 'fa')
      );
    }
  });
