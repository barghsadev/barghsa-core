import { expect, it } from 'vitest';
import { crmCorrectionQueryOptions, crmCorrectionSearch } from './crm-correction-query.js';
import { parseListQuery, writeListQuery } from '../hooks/useListQuery.js';
import { crmProfileId } from '../test/crm-recovery-fixtures.js';

it('serializes only public correction selections and preserves profile context', () => {
  expect(
    crmCorrectionSearch({
      profileId: crmProfileId,
      fieldName: 'last_name',
      status: 'Under Review',
      page: '2',
      requestedValue: 'private',
      reason: 'private',
      reviewerNotes: 'private',
      password: 'private',
      evidence: 'private',
    })
  ).toEqual({ profileId: crmProfileId, fieldName: 'last_name', status: 'Under Review', page: 2 });
});
it.each(['Open', undefined, null, [], {}, 'approved', 'Approved ', 'private'])(
  'defaults invalid or default status %j',
  (status) => {
    expect(crmCorrectionSearch({ status }).status).toBeUndefined();
    expect(parseListQuery({ status }, crmCorrectionQueryOptions).filters.status).toBe('Open');
  }
);
it.each(['Under Review', 'Approved', 'Rejected'])('preserves supported status %s', (status) => {
  expect(crmCorrectionSearch({ status }).status).toBe(status);
});
it.each([null, [], {}, 'private', ` ${crmProfileId}`, `${crmProfileId} `])(
  'rejects malformed profile identity %j',
  (profileId) => {
    expect(crmCorrectionSearch({ profileId }).profileId).toBeUndefined();
  }
);
it.each([0, -1, 1.5, 1_000_001, [], {}, '2.0', ' 2', 'private'])(
  'defaults malformed page %j',
  (page) => {
    expect(crmCorrectionSearch({ page }).page).toBeUndefined();
  }
);
it('resets paging on status changes without discarding the profile or field', () => {
  const raw = { profileId: crmProfileId, fieldName: 'first_name', status: 'Approved', page: 7 };
  expect(
    crmCorrectionSearch(
      writeListQuery(raw, crmCorrectionQueryOptions, { filters: { status: 'Rejected' } })
    )
  ).toEqual({
    profileId: crmProfileId,
    fieldName: 'first_name',
    status: 'Rejected',
    page: undefined,
  });
  expect(
    crmCorrectionSearch(writeListQuery(raw, crmCorrectionQueryOptions, { page: 8 })).page
  ).toBe(8);
  expect(crmCorrectionSearch({ fieldName: 'private', page: 1 })).toEqual({
    profileId: undefined,
    fieldName: undefined,
    status: undefined,
    page: undefined,
  });
});
