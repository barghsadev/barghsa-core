import { expect, it } from 'vitest';
import { assertRefundTransition, type RefundState } from './refund-state.model.js';
const valid: [RefundState, RefundState][] = [
  ['Requested', 'Approved'],
  ['Requested', 'Rejected'],
  ['Requested', 'Cancelled'],
  ['Approved', 'Processing'],
  ['Approved', 'Rejected'],
  ['Approved', 'Cancelled'],
  ['Processing', 'Completed'],
  ['Processing', 'Failed'],
  ['Failed', 'Processing'],
];
it.each(valid)('allows %s to %s', (from, to) =>
  expect(() => assertRefundTransition(from, to)).not.toThrow()
);
it.each(['Completed', 'Rejected', 'Cancelled'] as const)('keeps %s terminal', (from) => {
  for (const to of [
    'Requested',
    'Approved',
    'Processing',
    'Completed',
    'Failed',
    'Rejected',
    'Cancelled',
  ] as const)
    expect(() => assertRefundTransition(from, to)).toThrow();
});
it('cannot skip approval/processing or release a failed reservation', () => {
  for (const [from, to] of [
    ['Requested', 'Processing'],
    ['Requested', 'Completed'],
    ['Approved', 'Completed'],
    ['Failed', 'Cancelled'],
    ['Failed', 'Rejected'],
  ] as [RefundState, RefundState][])
    expect(() => assertRefundTransition(from, to)).toThrow();
});
