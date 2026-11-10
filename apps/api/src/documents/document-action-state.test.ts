import { expect, it } from 'vitest';
import { documentState } from '@barghsa/db';
import { documentActionTarget } from './document-action-state.js';

it.each([
  ['submit', 'SubmittedForReview', ['Available']],
  ['approve', 'Approved', ['SubmittedForReview']],
  ['reject', 'Rejected', ['SubmittedForReview']],
  ['request-changes', 'Available', ['SubmittedForReview']],
  [
    'quarantine',
    'Quarantined',
    [
      'Uploading',
      'PendingScan',
      'Available',
      'SubmittedForReview',
      'Approved',
      'Rejected',
      'Superseded',
    ],
  ],
  ['remove', 'Removed', ['Uploading', 'PendingScan', 'Superseded', 'Quarantined']],
] as const)('enforces each standard %s source', (action, target, sources) => {
  const permitted = new Set<string>(sources);
  for (const state of documentState.enumValues) {
    expect(documentActionTarget(action, state, 'standard'), state).toBe(
      permitted.has(state) ? target : null
    );
  }
});

it.each([
  ['saving-customer', ['Uploading', 'PendingScan', 'Available']],
  [
    'solar-customer',
    ['Uploading', 'PendingScan', 'Available', 'SubmittedForReview', 'Approved', 'Rejected'],
  ],
  ['solar-staff', ['Uploading', 'PendingScan', 'Superseded', 'Quarantined']],
] as const)('preserves %s removal boundaries', (scope, sources) => {
  const permitted = new Set<string>(sources);
  for (const state of documentState.enumValues) {
    expect(documentActionTarget('remove', state, scope), state).toBe(
      permitted.has(state) ? 'Removed' : null
    );
  }
});

it.each([
  ['approve', 'Approved'],
  ['reject', 'Rejected'],
  ['request-changes', 'Available'],
] as const)('allows solar staff to %s only from the two reviewable states', (action, target) => {
  for (const state of documentState.enumValues) {
    expect(documentActionTarget(action, state, 'solar-staff'), state).toBe(
      ['Available', 'SubmittedForReview'].includes(state) ? target : null
    );
  }
});
