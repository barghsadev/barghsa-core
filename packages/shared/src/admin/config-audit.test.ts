import { expect, it } from 'vitest';
import * as admin from './index.js';
const { isConfigAuditPage } = admin;
const entry = {
  id: '01900000-0000-7000-8000-000000000001',
  actorId: 'actor',
  createdAt: '2026-09-30T12:00:00.000001Z',
  event: 'updated',
  version: 1,
  detailsAvailable: true,
  changes: [
    {
      field: 'ttlSeconds',
      previous: { recorded: false, value: null },
      current: { recorded: true, value: 300 },
    },
  ],
};
it('accepts the bounded public audit page', () =>
  expect(isConfigAuditPage({ scope: 'otp', items: [entry], nextCursor: null })).toBe(true));
it.each([
  { ...entry, id: 'invalid' },
  { ...entry, actorId: [] },
  { ...entry, createdAt: 'invalid' },
  { ...entry, createdAt: '2026-02-31T12:00:00.000001Z' },
  { ...entry, event: 'unknown' },
  { ...entry, version: NaN },
  { ...entry, changes: [...entry.changes, ...entry.changes] },
  { ...entry, changes: [{ ...entry.changes[0], field: 'password' }] },
  { ...entry, changes: [{ ...entry.changes[0], previous: { recorded: false, value: 'private' } }] },
  {
    ...entry,
    changes: [{ ...entry.changes[0], current: { recorded: true, value: { secret: 'hidden' } } }],
  },
])('rejects invalid or unsafe audit entries %#', (row) =>
  expect(isConfigAuditPage({ scope: 'otp', items: [row], nextCursor: null })).toBe(false)
);
it('rejects duplicate entries and an oversized page or cursor', () => {
  expect(isConfigAuditPage({ scope: 'otp', items: [entry, entry], nextCursor: null })).toBe(false);
  expect(isConfigAuditPage({ scope: 'otp', items: Array(51).fill(entry), nextCursor: null })).toBe(
    false
  );
  expect(isConfigAuditPage({ scope: 'otp', items: [entry], nextCursor: 'x'.repeat(513) })).toBe(
    false
  );
});
it('keeps config pages, workflow decisions and staff authority available from the admin entry point', () => {
  expect(admin.isServiceWorkflowPolicy(admin.DEFAULT_SERVICE_WORKFLOWS)).toBe(true);
  expect(admin.resolveStaffPermissions(['["finance:read"]', 'bad JSON', ['finance:read']])).toEqual(
    ['finance:read']
  );
  expect(admin.isOperationalRetention(admin.defaultOperationalRetention)).toBe(true);
  expect(admin.isReconciliationStatus('resolved')).toBe(true);
  expect(admin.isReconciliationStatus('settled')).toBe(false);
});
