import { expect, it } from 'vitest';
import { knowledgePolicyFormText } from './knowledge-policy-forms.js';
for (const locale of ['en', 'fa'] as const)
  it(`has owned knowledge/policy feedback in ${locale}`, () => {
    for (const key of [
      'member',
      'query',
      'title',
      'description',
      'audience',
      'sourceType',
      'sourceUrl',
      'chunkSize',
      'chunkOverlap',
      'vectorEmbeddingModel',
      'policyType',
      'priority',
      'items',
      'tone',
      'language',
      'maxLength',
      'format',
      'maxRequests',
      'windowSeconds',
      'enabled',
      'requireSources',
      'invalid',
      'unavailable',
      'changed',
      'uncertain',
      'reset',
    ] as const)
      expect(knowledgePolicyFormText(key, locale)).toBeTruthy();
  });
