import { readKnowledgeMetadata, type KnowledgePolicyCheck } from './knowledge-assistant.js';

export const chatSlots = [
  'individual_chatbot',
  'legal_entity_chatbot',
  'staff_chatbot',
  'website_chatbot',
  'telegram_chatbot',
] as const;
export type AssistantAvailability = {
  available: boolean;
  profileId: string | null;
  profileName: string | null;
  slotKey: 'individual_chatbot' | 'legal_entity_chatbot' | null;
};
type Source = { kbId: string; title: string; documentTitle: string | null; excerpt: string };
export type KnowledgeAnswer = {
  reply: string;
  sources: Source[];
  attribution: 'retrieved_context';
  remainingQuota: number;
  policyChecks: KnowledgePolicyCheck[] | null;
  answeredAt: string | null;
};
export type TestChatResult = {
  conversationId: string;
  reply: string;
  sources: Source[];
  attribution: 'retrieved_context' | 'general_guidance';
  policyResults: { id: string; title: string; type: string; result: 'applied' | 'blocked' }[];
  tokenUsage: { input: number; output: number } | null;
  latencyMs: number;
  remainingQuota: number;
};
export function chatRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
const uuid = (value: unknown) =>
  typeof value === 'string' && /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value);
const count = (value: unknown, max = Number.MAX_SAFE_INTEGER): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max;
const sources = (value: unknown): value is Source[] =>
  Array.isArray(value) &&
  value.every(
    (source: unknown) =>
      chatRecord(source) &&
      uuid(source.kbId) &&
      text(source.title) &&
      (source.documentTitle === null || typeof source.documentTitle === 'string') &&
      typeof source.excerpt === 'string'
  );

export function readAssistantAvailability(value: unknown): AssistantAvailability | null {
  if (
    !chatRecord(value) ||
    typeof value.available !== 'boolean' ||
    !(value.profileName === null || typeof value.profileName === 'string')
  )
    return null;
  if (value.available) {
    if (
      !text(value.profileId) ||
      typeof value.slotKey !== 'string' ||
      !['individual_chatbot', 'legal_entity_chatbot'].includes(value.slotKey)
    )
      return null;
  } else if (
    !(value.profileId === null || text(value.profileId)) ||
    !(
      value.slotKey === null ||
      (typeof value.slotKey === 'string' &&
        ['individual_chatbot', 'legal_entity_chatbot'].includes(value.slotKey))
    )
  )
    return null;
  return value as AssistantAvailability;
}
export function readKnowledgeAnswer(value: unknown): KnowledgeAnswer | null {
  if (
    !chatRecord(value) ||
    !text(value.reply) ||
    !sources(value.sources) ||
    !value.sources.length ||
    value.attribution !== 'retrieved_context' ||
    !count(value.remainingQuota, 5)
  )
    return null;
  return {
    reply: value.reply,
    sources: value.sources,
    attribution: 'retrieved_context',
    remainingQuota: value.remainingQuota,
    ...readKnowledgeMetadata(value),
  };
}
export function readTestChatResult(value: unknown, conversationId?: string): TestChatResult | null {
  if (
    !chatRecord(value) ||
    !uuid(value.conversationId) ||
    (conversationId !== undefined && value.conversationId !== conversationId) ||
    !text(value.reply) ||
    !sources(value.sources) ||
    typeof value.attribution !== 'string' ||
    !['retrieved_context', 'general_guidance'].includes(value.attribution) ||
    (value.attribution === 'retrieved_context' ? !value.sources.length : !!value.sources.length) ||
    !count(value.remainingQuota, 10) ||
    typeof value.latencyMs !== 'number' ||
    !Number.isFinite(value.latencyMs) ||
    value.latencyMs < 0 ||
    !(
      value.tokenUsage === null ||
      (chatRecord(value.tokenUsage) &&
        count(value.tokenUsage.input) &&
        count(value.tokenUsage.output))
    ) ||
    !Array.isArray(value.policyResults)
  )
    return null;
  const seen = new Set<string>();
  for (const policy of value.policyResults as unknown[]) {
    if (
      !chatRecord(policy) ||
      !text(policy.id) ||
      seen.has(policy.id) ||
      !text(policy.title) ||
      typeof policy.type !== 'string' ||
      ![
        'allowed_topics',
        'disallowed_actions',
        'content_filter',
        'data_access_scope',
        'response_style',
        'output_format',
        'rate_limit',
      ].includes(policy.type) ||
      typeof policy.result !== 'string' ||
      !['applied', 'blocked'].includes(policy.result)
    )
      return null;
    seen.add(policy.id);
  }
  return value as TestChatResult;
}
