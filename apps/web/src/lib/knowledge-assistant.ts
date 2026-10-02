const policyTypes = [
  'allowed_topics',
  'disallowed_actions',
  'content_filter',
  'data_access_scope',
  'response_style',
  'output_format',
  'rate_limit',
] as const;

export type KnowledgePolicyCheck = { type: (typeof policyTypes)[number]; count: number };

/** Unknown or incomplete metadata must not become a claim that checks passed. */
export function readKnowledgeMetadata(answer: { answeredAt?: unknown; policyChecks?: unknown }): {
  answeredAt: string | null;
  policyChecks: KnowledgePolicyCheck[] | null;
} {
  const answeredAt =
    typeof answer.answeredAt === 'string' &&
    /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(answer.answeredAt) &&
    Number.isFinite(Date.parse(answer.answeredAt))
      ? answer.answeredAt
      : null;
  const seen = new Set<string>();
  const policyChecks =
    Array.isArray(answer.policyChecks) &&
    answer.policyChecks.length <= policyTypes.length &&
    answer.policyChecks.every((check: unknown) => {
      if (!check || typeof check !== 'object') return false;
      const { type, count } = check as { type?: unknown; count?: unknown };
      if (
        typeof type !== 'string' ||
        !policyTypes.some((known) => known === type) ||
        seen.has(type) ||
        typeof count !== 'number' ||
        !Number.isSafeInteger(count) ||
        count < 1
      )
        return false;
      seen.add(type);
      return true;
    })
      ? (answer.policyChecks as KnowledgePolicyCheck[]).map(({ type, count }) => ({ type, count }))
      : null;
  return { answeredAt, policyChecks };
}

/** Route categories are UI hints only. Paths and account data never enter model requests. */
export function knowledgeSuggestions(
  pathname: string,
  slotKey: 'individual_chatbot' | 'legal_entity_chatbot'
): string[] {
  const category = pathname.split('/')[1];
  const prompts: Record<string, string[]> = {
    electricity: ['documents', 'orderStatus', 'payment'],
    savings: ['savings', 'orderStatus', 'payment'],
    solar: ['solar', 'postal', 'contracts'],
    wallet: ['wallet', 'payment', 'refunds'],
    invoices: ['payment', 'invoiceStatus', 'refunds'],
    contracts: ['contracts', 'postal', 'orderStatus'],
    documents: ['documents', 'documentReview', 'contracts'],
    tickets: ['support', 'ticketStatus', 'documents'],
    consultations: ['consultations', 'documents', 'payment'],
  };
  const contextual =
    category && Object.hasOwn(prompts, category)
      ? prompts[category]!
      : [
          slotKey === 'legal_entity_chatbot' ? 'legalDocuments' : 'documents',
          'payment',
          'orderStatus',
        ];
  return [...new Set([...contextual, 'support'])].map((key) => `assistant.suggestion.${key}`);
}
