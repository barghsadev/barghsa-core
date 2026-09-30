import { expect, it } from 'vitest';
import { parseStatusFilter, SAVING_ORDER_STATUSES } from './request-status-filter.js';

it('normalizes status selection to the allowlist order and removes duplicates', () => {
  expect(parseStatusFilter('completed,submitted,completed', SAVING_ORDER_STATUSES)).toEqual([
    'submitted',
    'completed',
  ]);
  expect(parseStatusFilter(undefined, SAVING_ORDER_STATUSES)).toEqual([]);
  expect(parseStatusFilter('', SAVING_ORDER_STATUSES)).toEqual([]);
});

it.each(['unknown', 'submitted,unknown', 'submitted,', ['submitted'], 1, 'x'.repeat(501)])(
  'rejects invalid filters without turning them into an unfiltered query: %s',
  (input) => {
    expect(parseStatusFilter(input, SAVING_ORDER_STATUSES)).toBeNull();
  }
);
