import { describe, expect, it } from 'vitest';
import { knowledgeSuggestions, readKnowledgeMetadata } from './knowledge-assistant.js';

describe('knowledge answer metadata', () => {
  it('distinguishes older answers from answers without additional policies', () => {
    expect(readKnowledgeMetadata({})).toEqual({ answeredAt: null, policyChecks: null });
    expect(readKnowledgeMetadata({ policyChecks: [] }).policyChecks).toEqual([]);
  });

  it('keeps recorded UTC and offset times and strips private metadata', () => {
    const answeredAt = '2026-10-02T10:30:00+00:00';
    expect(
      readKnowledgeMetadata({
        answeredAt,
        policyChecks: [{ type: 'content_filter', count: 2, rules: 'private', id: 'private' }],
      })
    ).toEqual({ answeredAt, policyChecks: [{ type: 'content_filter', count: 2 }] });
    expect(readKnowledgeMetadata({ answeredAt: '2026-10-02T10:30:00Z' }).answeredAt).not.toBeNull();
  });

  it.each(
    [
      null,
      {},
      [{ type: 'future_policy', count: 1 }],
      [{ type: 'content_filter', count: 0 }],
      [{ type: 'content_filter', count: 1.5 }],
      [{ type: 'content_filter', count: '1' }],
      [{ type: 'content_filter', count: Number.MAX_SAFE_INTEGER + 1 }],
      [null],
      [
        { type: 'content_filter', count: 1 },
        { type: 'content_filter', count: 2 },
      ],
    ].map((policyChecks) => ({ policyChecks }))
  )('does not claim checks for malformed metadata: %j', ({ policyChecks }) => {
    expect(readKnowledgeMetadata({ policyChecks }).policyChecks).toBeNull();
  });

  it.each([null, 123, 'yesterday', '2026-10-02', '2026-10-02T10:30:00', 'badZ'])(
    'does not infer an answer time from %j',
    (answeredAt) => expect(readKnowledgeMetadata({ answeredAt }).answeredAt).toBeNull()
  );
});

describe('workflow prompts', () => {
  it('uses only the service category and keeps private route identifiers out of prompts', () => {
    expect(knowledgeSuggestions('/solar/requests/private-order', 'individual_chatbot')).toEqual([
      'assistant.suggestion.solar',
      'assistant.suggestion.postal',
      'assistant.suggestion.contracts',
      'assistant.suggestion.support',
    ]);
    expect(knowledgeSuggestions('/wallet', 'individual_chatbot')[0]).toBe(
      'assistant.suggestion.wallet'
    );
  });

  it.each(['/ai', '/', '/solar-elsewhere', '/__proto__', '/constructor'])(
    'uses profile-specific defaults for non-service routes: %s',
    (path) => {
      expect(knowledgeSuggestions(path, 'legal_entity_chatbot')[0]).toBe(
        'assistant.suggestion.legalDocuments'
      );
      expect(knowledgeSuggestions(path, 'individual_chatbot')[0]).toBe(
        'assistant.suggestion.documents'
      );
    }
  );

  it('does not duplicate support prompts', () => {
    expect(knowledgeSuggestions('/tickets/ticket-id', 'individual_chatbot')).toHaveLength(3);
  });
});
