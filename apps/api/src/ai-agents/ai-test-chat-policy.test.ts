import { expect, it } from 'vitest';
import { evaluatePolicies, type RuntimePolicy } from './ai-test-chat-policy.js';

const policy = (
  id: string,
  type: RuntimePolicy['policy_type'],
  rules: Record<string, unknown>
): RuntimePolicy => ({ id, title: id, policy_type: type, rules });

it('blocks outside topics and disallowed actions before model invocation', () => {
  const policies = [
    policy('topics', 'allowed_topics', { topics: ['electricity'] }),
    policy('actions', 'disallowed_actions', { actions: ['refund'] }),
  ];
  expect(evaluatePolicies(policies, 'electricity prices').blocked).toBe(false);
  expect(evaluatePolicies(policies, 'please refund electricity').results).toEqual([
    { id: 'topics', title: 'topics', type: 'allowed_topics', result: 'applied' },
    { id: 'actions', title: 'actions', type: 'disallowed_actions', result: 'blocked' },
  ]);
  expect(evaluatePolicies(policies, 'gas prices').blocked).toBe(true);
});

it('intersects data scopes and applies the strictest output length', () => {
  const result = evaluatePolicies(
    [
      policy('scope-1', 'data_access_scope', { scopes: ['all', 'kb:one'] }),
      policy('scope-2', 'data_access_scope', { scopes: ['kb:one'] }),
      policy('style-1', 'response_style', { tone: 'concise', maxLength: 500 }),
      policy('style-2', 'response_style', { language: 'fa', maxLength: 100 }),
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
});
