import { expect, it } from 'vitest';
import {
  invalidKnowledgeFields,
  invalidPolicyFields,
  knowledgeBody,
  policyBody,
  policyPriority,
  matchesAiCatalogueReceipt,
  type KnowledgeDraft,
  type PolicyDraft,
} from './knowledge-policy-form.js';
const knowledge: KnowledgeDraft = {
  title: 'Knowledge',
  description: '',
  audience: 'admin',
  sourceType: 'document',
  sourceUrl: '',
  chunkSize: '800',
  chunkOverlap: '100',
  vectorEmbeddingModel: '',
};
const policy: PolicyDraft = {
  title: 'Policy',
  description: '',
  policyType: 'allowed_topics',
  enabled: true,
  priority: '100',
  items: 'energy',
  tone: '',
  language: '',
  maxLength: '',
  requireSources: false,
  format: 'plain_text',
  maxRequests: '10',
  windowSeconds: '60',
};
it.each([
  '',
  'http://example.test',
  'https://',
  'https://example.test\nhttp://bad.test',
  Array(21).fill('https://example.test').join('\n'),
  `https://example.test/${'x'.repeat(2048)}`,
])('rejects invalid web sources %#', (sourceUrl) => {
  expect(
    invalidKnowledgeFields({ ...knowledge, sourceType: 'url', sourceUrl }, 'knowledge-bases')
  ).toContain('sourceUrl');
});
it('preserves localized integer source settings and enforces overlap smaller than size', () => {
  const value = {
    ...knowledge,
    sourceType: 'url' as const,
    sourceUrl: ' https://one.test\r\n\n https://two.test ',
    chunkSize: '۸۰۰',
    chunkOverlap: '۱۰۰',
  };
  expect(invalidKnowledgeFields(value, 'knowledge-bases')).toEqual([]);
  expect(knowledgeBody(value, 'knowledge-bases')).toMatchObject({
    sourceConfig: { urls: ['https://one.test', 'https://two.test'] },
    chunkingStrategy: { size: 800, overlap: 100 },
  });
  for (const chunkSize of ['', '99', '4001', '1e3', '800.0'])
    expect(invalidKnowledgeFields({ ...value, chunkSize }, 'knowledge-bases')).toContain(
      'chunkSize'
    );
  for (const chunkOverlap of ['', '800', '-1', '1001', '1.5'])
    expect(invalidKnowledgeFields({ ...value, chunkOverlap }, 'knowledge-bases')).toContain(
      'chunkOverlap'
    );
});
it('validates one HTTPS API source and ignores inactive source work for a group', () => {
  expect(
    invalidKnowledgeFields(
      { ...knowledge, sourceType: 'api', sourceUrl: 'https://api.test/v1' },
      'knowledge-bases'
    )
  ).toEqual([]);
  expect(
    invalidKnowledgeFields(
      { ...knowledge, sourceType: 'api', sourceUrl: 'https://one.test\nhttps://two.test' },
      'knowledge-bases'
    )
  ).toContain('sourceUrl');
  expect(
    invalidKnowledgeFields({ ...knowledge, chunkSize: '', sourceType: 'api' }, 'kb-groups')
  ).toEqual([]);
  expect(knowledgeBody(knowledge, 'kb-groups')).toEqual({ title: 'Knowledge', description: '' });
});
it.each(['-۱۰۰۰', '۱۰۰۰', '٠', '000100'])(
  'accepts exact localized signed priorities %s',
  (priority) => {
    expect(policyPriority(priority)).not.toBeNull();
    expect(invalidPolicyFields({ ...policy, priority }, 'policies')).toEqual([]);
  }
);
it.each(['', '-', '-1001', '1001', '1e2', '1.0', 'Infinity'])(
  'rejects malformed priorities %s',
  (priority) => {
    expect(invalidPolicyFields({ ...policy, priority }, 'policies')).toContain('priority');
  }
);
it('validates response style, list and rate limits on their owning fields', () => {
  expect(invalidPolicyFields({ ...policy, items: 'x'.repeat(201) }, 'policies')).toEqual(['items']);
  expect(
    invalidPolicyFields(
      {
        ...policy,
        policyType: 'response_style',
        tone: ' ',
        language: 'x'.repeat(51),
        maxLength: '0',
      },
      'policies'
    )
  ).toEqual(['tone', 'language', 'maxLength']);
  expect(
    invalidPolicyFields(
      { ...policy, policyType: 'rate_limit', maxRequests: '101', windowSeconds: '' },
      'policies'
    )
  ).toEqual(['maxRequests', 'windowSeconds']);
  expect(
    policyBody(
      {
        ...policy,
        policyType: 'rate_limit',
        maxRequests: '۱۰',
        windowSeconds: '۶۰',
        priority: '-۵',
      },
      'policies'
    )
  ).toMatchObject({ rules: { maxRequests: 10, windowSeconds: 60 }, priority: -5 });
  expect(invalidPolicyFields({ ...policy, priority: '', items: '' }, 'policy-groups')).toEqual([]);
});
it.each([
  knowledgeBody(knowledge, 'knowledge-bases'),
  knowledgeBody(knowledge, 'kb-groups'),
  policyBody(policy, 'policies'),
  policyBody(policy, 'policy-groups'),
])('requires exact captured identity and settings in a save receipt %#', (body) => {
  const id = '01900000-0000-7000-8000-000000000001',
    receipt = { ...body, id, createdAt: 'metadata' };
  expect(matchesAiCatalogueReceipt(receipt, body, id)).toBe(true);
  expect(matchesAiCatalogueReceipt({ ...receipt, id: 'other' }, body, id)).toBe(false);
  expect(matchesAiCatalogueReceipt({ ...receipt, title: 'Other' }, body, id)).toBe(false);
  expect(matchesAiCatalogueReceipt({ id }, body, id)).toBe(false);
});
it('compares nested rule/source keys independently of order while rejecting changed entries', () => {
  const id = '01900000-0000-7000-8000-000000000001';
  const body = { rules: { language: 'fa', tone: 'calm', topics: ['energy', 'billing'] } };
  expect(
    matchesAiCatalogueReceipt(
      { id, rules: { topics: ['energy', 'billing'], tone: 'calm', language: 'fa' } },
      body
    )
  ).toBe(true);
  expect(
    matchesAiCatalogueReceipt({ id, rules: { ...body.rules, topics: ['billing', 'energy'] } }, body)
  ).toBe(false);
  expect(matchesAiCatalogueReceipt({ id, rules: { ...body.rules, extra: true } }, body)).toBe(
    false
  );
});
