import { expect, it } from 'vitest';
import {
  readAssistantAvailability,
  readKnowledgeAnswer,
  readTestChatResult,
} from './assistant-chat.js';
const id = '01900000-0000-7000-8000-000000000001';
const source = { kbId: id, title: 'Guide', documentTitle: null, excerpt: 'Published passage' };
const answer = {
  reply: 'Answer',
  sources: [source],
  attribution: 'retrieved_context',
  remainingQuota: 4,
};
const result = {
  ...answer,
  conversationId: id,
  policyResults: [{ id, title: 'Style', type: 'response_style', result: 'applied' }],
  tokenUsage: { input: 9, output: 5 },
  latencyMs: 12,
  remainingQuota: 9,
};
it('accepts current contracts, legacy missing customer metadata, and unassigned availability', () => {
  expect(readKnowledgeAnswer(answer)).toEqual({ ...answer, answeredAt: null, policyChecks: null });
  expect(readTestChatResult(result, id)).toEqual(result);
  expect(
    readTestChatResult({
      ...result,
      sources: [],
      attribution: 'general_guidance',
      tokenUsage: null,
    })
  ).not.toBeNull();
  expect(
    readAssistantAvailability({
      available: false,
      profileId: null,
      profileName: null,
      slotKey: null,
    })
  ).not.toBeNull();
  expect(
    readAssistantAvailability({
      available: true,
      profileId: id,
      profileName: null,
      slotKey: 'individual_chatbot',
    })
  ).not.toBeNull();
});
it.each([
  null,
  [],
  {},
  { ...answer, reply: '' },
  { ...answer, sources: [] },
  { ...answer, sources: null },
  { ...answer, sources: [{ ...source, kbId: 'invalid' }] },
  { ...answer, sources: [{ ...source, documentTitle: 1 }] },
  { ...answer, attribution: 'general_guidance' },
  { ...answer, remainingQuota: 6 },
  { ...answer, remainingQuota: -1 },
  { ...answer, remainingQuota: 1.5 },
])('refuses malformed customer answer %#', (value) => {
  expect(readKnowledgeAnswer(value)).toBeNull();
});
it.each([
  null,
  [],
  {},
  { ...result, conversationId: 'invalid' },
  { ...result, sources: [] },
  { ...result, attribution: 'general_guidance' },
  { ...result, policyResults: null },
  { ...result, policyResults: [...result.policyResults, ...result.policyResults] },
  { ...result, policyResults: [{ ...result.policyResults[0], type: 'private' }] },
  { ...result, tokenUsage: { input: -1, output: 2 } },
  { ...result, latencyMs: Infinity },
  { ...result, remainingQuota: 11 },
])('refuses malformed staff answer %#', (value) => {
  expect(readTestChatResult(value)).toBeNull();
});
it.each([
  null,
  {},
  { available: 'true', profileId: id, profileName: null, slotKey: 'individual_chatbot' },
  { available: true, profileId: null, profileName: null, slotKey: 'individual_chatbot' },
  { available: true, profileId: id, profileName: null, slotKey: 'staff_chatbot' },
  { available: true, profileId: id, profileName: 10, slotKey: 'individual_chatbot' },
])('refuses malformed availability %#', (value) => {
  expect(readAssistantAvailability(value)).toBeNull();
});
it('keeps incomplete public metadata unavailable instead of inventing policy approval', () => {
  expect(
    readKnowledgeAnswer({
      ...answer,
      policyChecks: [{ type: 'private', count: 1 }],
      answeredAt: 'invalid',
    })
  ).toMatchObject({ policyChecks: null, answeredAt: null });
});
it('rejects array-valued contract fields that stringify to known identifiers', () => {
  for (const available of [true, false]) {
    expect(
      readAssistantAvailability({
        available,
        profileId: id,
        profileName: null,
        slotKey: ['individual_chatbot'],
      })
    ).toBeNull();
  }
  expect(
    readTestChatResult({ ...result, sources: [], attribution: ['general_guidance'] })
  ).toBeNull();
  for (const invalid of [{ type: ['response_style'] }, { result: ['applied'] }]) {
    expect(
      readTestChatResult({
        ...result,
        policyResults: [{ ...result.policyResults[0], ...invalid }],
      })
    ).toBeNull();
  }
});
