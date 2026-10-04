import { expect, it } from 'vitest';
import {
  evaluatePolicies,
  evaluatePolicyOutput,
  type RuntimePolicy,
} from './ai-test-chat-policy.js';

const policy = (
  id: string,
  type: RuntimePolicy['policy_type'],
  rules: Record<string, unknown>,
  priority = 100
): RuntimePolicy => ({ id, title: id, policy_type: type, rules, priority });

it('blocks outside topics and disallowed actions before model invocation', () => {
  const policies = [
    policy('topics', 'allowed_topics', { topics: ['electricity'] }),
    policy('actions', 'disallowed_actions', { actions: ['refund'] }),
  ];
  expect(evaluatePolicies(policies, 'electricity prices').blocked).toBe(false);
  expect(evaluatePolicies(policies, 'please refund electricity').results).toEqual([
    {
      id: 'actions',
      title: 'actions',
      type: 'disallowed_actions',
      priority: 100,
      result: 'blocked',
      ruleChecks: [{ rule: 'actions', outcome: 'blocked' }],
    },
    {
      id: 'topics',
      title: 'topics',
      type: 'allowed_topics',
      priority: 100,
      result: 'applied',
      ruleChecks: [{ rule: 'topics', outcome: 'matched' }],
    },
  ]);
  expect(evaluatePolicies(policies, 'gas prices').blocked).toBe(true);
});

it('uses effective priority for style and format while composing restrictive rules', () => {
  const result = evaluatePolicies(
    [
      policy('low-style', 'response_style', { tone: 'warm', maxLength: 40 }, 50),
      policy('high-style', 'response_style', { tone: 'direct', maxLength: 100 }, -5),
      policy('low-format', 'output_format', { format: 'plain_text' }, 40),
      policy('high-format', 'output_format', { format: 'json_object' }, -10),
    ],
    'energy'
  );
  expect(result.results.map((item) => item.id)).toEqual([
    'high-format',
    'high-style',
    'low-format',
    'low-style',
  ]);
  expect(result.instructions).toContain('Use this response tone: direct.');
  expect(result.instructions).not.toContain('Use this response tone: warm.');
  expect(result.outputFormat).toEqual({ format: 'json_object', policyId: 'high-format' });
  expect(result.maxLength).toBe(40);
  expect(result.results.find((item) => item.id === 'high-style')?.ruleChecks).toEqual([
    { rule: 'tone', outcome: 'applied' },
    { rule: 'maxLength', outcome: 'overridden' },
  ]);
  expect(result.results.find((item) => item.id === 'low-style')?.ruleChecks).toEqual([
    { rule: 'tone', outcome: 'overridden' },
    { rule: 'maxLength', outcome: 'applied' },
  ]);
  expect(result.results.find((item) => item.id === 'low-format')?.ruleChecks).toEqual([
    { rule: 'format', outcome: 'overridden' },
  ]);
  expect(result.requireSourcesPolicyId).toBeNull();
  expect(evaluatePolicyOutput(result, '{"ok":true}').blocked).toBe(false);
  expect(evaluatePolicyOutput(result, 'not json')).toEqual({
    blocked: true,
    reason: 'output_format_invalid',
    policyRef: 'high-format',
  });
});

it('uses the highest-priority policy that requires retrieved sources', () => {
  const result = evaluatePolicies(
    [
      policy('lower', 'response_style', { tone: 'clear', requireSources: true }, 20),
      policy('higher', 'response_style', { tone: 'brief', requireSources: true }, -20),
    ],
    'energy'
  );
  expect(result.requireSourcesPolicyId).toBe('higher');
});

it('filters both input and output, and fails closed for invalid stored rules', () => {
  const filtered = evaluatePolicies(
    [policy('filter', 'content_filter', { blockedTerms: ['secret'] })],
    'Tell me the secret'
  );
  expect(filtered).toMatchObject({ blocked: true, reason: 'input_filtered', policyRef: 'filter' });
  const allowed = evaluatePolicies(
    [policy('filter', 'content_filter', { blockedTerms: ['secret'] })],
    'Hello'
  );
  expect(evaluatePolicyOutput(allowed, 'This is secret')).toEqual({
    blocked: true,
    reason: 'output_filtered',
    policyRef: 'filter',
  });
  expect(
    evaluatePolicies([policy('invalid', 'rate_limit', { maxRequests: 0 })], 'Hello')
  ).toMatchObject({
    blocked: true,
    reason: 'policy_invalid',
    policyRef: 'invalid',
  });
});

it('intersects data scopes and applies the strictest output length', () => {
  const result = evaluatePolicies(
    [
      policy('scope-1', 'data_access_scope', { scopes: ['all', 'kb:one'] }),
      policy('scope-2', 'data_access_scope', { scopes: ['kb:one'] }),
      policy('style-1', 'response_style', { tone: 'concise', maxLength: 500 }),
      policy('style-2', 'response_style', { tone: 'formal', language: 'fa', maxLength: 100 }),
    ],
    'test'
  );
  expect([...result.scopes!]).toEqual(['kb:one']);
  expect(result.maxLength).toBe(100);
  expect(result.instructions).toEqual(['Use this response tone: concise.', 'Respond in fa.']);
  expect(
    evaluatePolicies(
      [
        policy('wildcard', 'data_access_scope', { scopes: ['all'] }),
        policy('specific', 'data_access_scope', { scopes: ['kb:one'] }),
      ],
      'test'
    ).scopes
  ).toEqual(new Set(['kb:one']));
  expect(
    evaluatePolicies(
      [
        policy('first', 'data_access_scope', { scopes: ['kb:one'] }),
        policy('second', 'data_access_scope', { scopes: ['kb:two'] }),
      ],
      'test'
    )
  ).toMatchObject({ blocked: true, reason: 'data_scope_empty', policyRef: 'second' });
});

it('records rule identities without exposing authored topic, action, filter, or scope values', () => {
  const result = evaluatePolicies(
    [
      policy('topic', 'allowed_topics', { topics: ['private topic'] }),
      policy('action', 'disallowed_actions', { actions: ['private action'] }),
      policy('filter', 'content_filter', { blockedTerms: ['private filter'] }),
      policy('scope', 'data_access_scope', { scopes: ['kb:private-scope'] }),
      policy('limit', 'rate_limit', { maxRequests: 1, windowSeconds: 60 }),
    ],
    'A private topic question'
  );
  expect(result.blocked).toBe(false);
  expect(result.results).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: 'topic',
        ruleChecks: [{ rule: 'topics', outcome: 'matched' }],
      }),
      expect.objectContaining({
        id: 'action',
        ruleChecks: [{ rule: 'actions', outcome: 'passed' }],
      }),
      expect.objectContaining({
        id: 'filter',
        ruleChecks: [{ rule: 'inputFilter', outcome: 'passed' }],
      }),
      expect.objectContaining({
        id: 'scope',
        ruleChecks: [{ rule: 'scopes', outcome: 'applied' }],
      }),
      expect.objectContaining({
        id: 'limit',
        ruleChecks: [{ rule: 'rateLimit', outcome: 'applied' }],
      }),
    ])
  );
  expect(JSON.stringify(result.results)).not.toMatch(
    /private topic|private action|private filter|private-scope/
  );
});

it('records source, language, and format precedence without claiming invalid rules matched', () => {
  const result = evaluatePolicies(
    [
      policy(
        'higher',
        'response_style',
        { tone: 'brief', language: 'en', requireSources: true },
        -20
      ),
      policy('lower', 'response_style', { tone: 'warm', language: 'fa', requireSources: true }, 20),
      policy('invalid', 'rate_limit', { maxRequests: 0 }),
    ],
    'energy'
  );
  expect(result.results.find((item) => item.id === 'lower')?.ruleChecks).toEqual([
    { rule: 'tone', outcome: 'overridden' },
    { rule: 'language', outcome: 'overridden' },
    { rule: 'requireSources', outcome: 'overridden' },
  ]);
  expect(result.results.find((item) => item.id === 'invalid')).toMatchObject({
    result: 'blocked',
    ruleChecks: [],
  });
});
