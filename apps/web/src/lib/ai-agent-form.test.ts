import { expect, it } from 'vitest';
import { aiAgent, aiDetail, aiOptions } from '../test/ai-catalogue-fixtures.js';
import {
  agentBody,
  agentDraftFor,
  invalidAgentFields,
  matchesAgentReceipt,
  matchesAgentDetail,
  detailSnapshot,
  validAgents,
  validDetail,
  validOptions,
} from './ai-agent-form.js';

it('keeps nullable model defaults and the complete link sets in the submitted body', () => {
  const draft = agentDraftFor(aiDetail);
  expect(invalidAgentFields(draft, aiOptions)).toEqual([]);
  expect(agentBody({ ...draft, title: '  Energy guide  ' })).toMatchObject({
    title: aiAgent.title,
    temperature: null,
    maxTokens: null,
    kbIds: [aiOptions.kbs[0]!.id],
    policyIds: [],
    kbGroupIds: [],
    policyGroupIds: [],
  });
  expect(agentBody({ ...draft, temperature: '0', maxTokens: '8192' })).toMatchObject({
    temperature: 0,
    maxTokens: 8192,
  });
});
it.each([
  ['title', '   '],
  ['description', 'a'.repeat(2001)],
  ['systemPrompt', 'a'.repeat(8001)],
  ['temperature', '-0.1'],
  ['temperature', '2.1'],
  ['temperature', 'Infinity'],
  ['maxTokens', '0'],
  ['maxTokens', '1.5'],
  ['maxTokens', '8193'],
  ['maxTokens', 'NaN'],
  ['modelId', 'not-a-model'],
] as const)('rejects invalid %s without losing the other fields', (field, value) => {
  expect(invalidAgentFields({ ...agentDraftFor(aiDetail), [field]: value }, aiOptions)).toContain(
    field
  );
});
it.each(['kbIds', 'policyIds', 'kbGroupIds', 'policyGroupIds'] as const)(
  'validates identifiers, uniqueness, membership and the cap for %s',
  (field) => {
    const draft = agentDraftFor(aiDetail);
    for (const ids of [
      ['not-a-uuid'],
      [aiOptions.kbs[0]!.id, aiOptions.kbs[0]!.id],
      Array(201).fill(aiOptions.kbs[0]!.id),
    ])
      expect(invalidAgentFields({ ...draft, [field]: ids }, aiOptions)).toContain(field);
    expect(
      invalidAgentFields({ ...draft, [field]: ['01900000-0000-7000-8000-000000000099'] }, aiOptions)
    ).toContain(field);
  }
);
it('requires the exact scalar receipt and a fresh full-set detail before acknowledging a save', () => {
  const draft = agentDraftFor(aiDetail);
  expect(matchesAgentReceipt(aiDetail, draft, aiAgent.id)).toBe(true);
  expect(matchesAgentReceipt(aiAgent, draft, aiAgent.id)).toBe(false);
  expect(matchesAgentReceipt({ ...aiDetail, maxTokens: 20 }, draft, aiAgent.id)).toBe(false);
  expect(matchesAgentReceipt({ ...aiDetail, id: '' }, draft)).toBe(false);
  expect(matchesAgentDetail({ ...aiDetail, kbs: [] }, draft, aiAgent.id)).toBe(false);
  expect(
    matchesAgentDetail(
      { ...aiDetail, kbs: aiDetail.kbs.map((v) => ({ ...v, title: 'Renamed' })) },
      draft,
      aiAgent.id
    )
  ).toBe(true);
});
it('treats names and set ordering as presentation, but preserves configuration changes', () => {
  const extra = { id: '01900000-0000-7000-8000-000000000022', title: 'Second KB' };
  const detail = { ...aiDetail, kbs: [...aiDetail.kbs, extra] };
  expect(detailSnapshot(detail)).toBe(
    detailSnapshot({
      ...detail,
      kbs: [...detail.kbs].reverse().map((v) => ({ ...v, title: 'New name' })),
    })
  );
  expect(detailSnapshot(detail)).not.toBe(detailSnapshot({ ...detail, linkMode: 'all_kbs' }));
});
it('rejects ambiguous catalogues and invalid numeric details', () => {
  expect(validAgents([aiAgent, aiAgent])).toBe(false);
  expect(validAgents([{ ...aiAgent, id: '' }])).toBe(false);
  expect(validOptions({ ...aiOptions, kbs: [...aiOptions.kbs, ...aiOptions.kbs] })).toBe(false);
  expect(validOptions({ ...aiOptions, models: [{ id: '', title: 'Missing ID' }] })).toBe(false);
  expect(validDetail({ ...aiDetail, maxTokens: 1.5 }, aiAgent.id)).toBe(false);
  expect(validDetail({ ...aiDetail, temperature: Infinity }, aiAgent.id)).toBe(false);
});

it.each(['kbCount', 'policyCount'] as const)(
  'rejects malformed %s instead of displaying a fabricated count',
  (field) => {
    for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '2'])
      expect(validAgents([{ ...aiAgent, [field]: value }])).toBe(false);
    expect(validAgents([{ ...aiAgent, [field]: 0 }])).toBe(true);
    expect(validAgents([{ ...aiAgent, [field]: undefined }])).toBe(true);
  }
);
