import { expect, it } from 'vitest';
import { writeListQuery } from '../hooks/useListQuery.js';
import {
  approvalQueueSearch,
  approvalQueueQueryOptions,
  reconciliationQueueSearch,
  reconciliationQueueQueryOptions,
  reconciliationApiQuery,
  reconciliationLocalTime,
} from './decision-queue-query.js';
const id = '82000000-0000-4000-8000-000000000001';
const from = '2026-09-01T07:00:15.123Z',
  before = '2026-09-03T07:00:00.000Z';
it('restores queue status/page independently of the exact linked approval', () => {
  expect(
    approvalQueueSearch({
      status: 'approved',
      page: '3',
      requestId: id.toUpperCase(),
      reason: 'private',
      password: 'private',
    })
  ).toEqual({ status: 'approved', page: 3, requestId: id });
  expect(
    approvalQueueSearch(
      writeListQuery({ requestId: id, status: 'approved', page: 4 }, approvalQueueQueryOptions, {
        filters: { status: 'pending' },
      })
    )
  ).toEqual({ requestId: id });
});
it.each([null, ['3'], '-1', '2.5', '1e3', 1_000_001])(
  'rejects malformed queue pages: %j',
  (page) => {
    expect(approvalQueueSearch({ page })).toEqual({});
    expect(reconciliationQueueSearch({ page })).toEqual({});
  }
);
it('uses the shared page maximum, independently of unrelated API limits', () => {
  expect(approvalQueueSearch({ page: 1_000_000 })).toEqual({ page: 1_000_000 });
  expect(reconciliationQueueSearch({ page: 40_002 })).toEqual({ page: 40_002 });
});
it.each([[], ['approved'], 'unknown', '<script>'])(
  'rejects invalid approval selectors: %j',
  (status) => {
    expect(approvalQueueSearch({ status, requestId: 'invalid' })).toEqual({});
  }
);
it('keeps all reconciliation criteria and API instants exact while omitting private work', () => {
  expect(
    reconciliationQueueSearch({
      status: 'all',
      severity: 'critical',
      createdFrom: from,
      createdBefore: before,
      page: 2,
      note: 'private',
      selected: id,
    })
  ).toEqual({
    status: 'all',
    severity: 'critical',
    createdFrom: from,
    createdBefore: before,
    page: 2,
  });
  expect(
    reconciliationApiQuery({
      status: 'all',
      severity: 'critical',
      createdFrom: from,
      createdBefore: before,
    })
  ).toBe(
    new URLSearchParams({
      severity: 'critical',
      createdFrom: from,
      createdBefore: before,
    }).toString()
  );
  expect(
    reconciliationQueueSearch(
      writeListQuery({ page: 3, status: 'closed' }, reconciliationQueueQueryOptions, {
        filters: { status: 'open' },
      })
    )
  ).toEqual({});
});
it.each([
  [],
  '2026-02-30T00:00:00.000Z',
  '2026-09-01T00:00:00Z',
  '2026-09-01',
  '0000-01-01T00:00:00.000Z',
])('rejects invalid/noncanonical UTC bounds: %j', (createdFrom) => {
  expect(
    reconciliationQueueSearch({ createdFrom, severity: 'unknown', status: ['closed'] })
  ).toEqual({});
});
it.each([from, '2026-08-01T00:00:00.000Z'])(
  'clears equal or inverted ranges: %s',
  (createdBefore) => {
    expect(reconciliationQueueSearch({ createdFrom: from, createdBefore })).toEqual({});
  }
);
it('restores wall-clock display in the account zone without truncating applied instants', () => {
  expect(reconciliationLocalTime(from, 'America/Los_Angeles')).toBe('2026-09-01T00:00');
  expect(reconciliationLocalTime(from, 'Asia/Tehran')).toBe('2026-09-01T10:30');
  expect(reconciliationLocalTime('', 'Asia/Tehran')).toBe('');
});
