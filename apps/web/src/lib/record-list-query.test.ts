import { expect, it } from 'vitest';
import {
  contractNumber,
  staffContractsSearch,
  staffDocumentsSearch,
  customerDocumentsSearch,
  staffContractQueryOptions,
} from './record-list-query.js';
import { writeListQuery } from '../hooks/useListQuery.js';
const id = '11111111-1111-4111-8111-111111111111';
it.each(['9223372036854775807', '123', 123])(
  'retains an exact valid contract number %s',
  (value) => {
    expect(contractNumber(value)).toBe(String(value));
  }
);
it.each(['0', '-1', '01', '9223372036854775808', ['12'], Number('9223372036854775807')])(
  'rejects invalid or rounded contract number %s',
  (value) => {
    expect(contractNumber(value)).toBe('');
  }
);
it('contract links keep only known criteria and UUID navigation', () => {
  expect(
    staffContractsSearch({
      contractNumber: '9223372036854775807',
      state: 'Active',
      serviceType: 'electricity',
      profileId: id,
      cursor: id,
      contractId: id,
      refundReason: 'Private',
      q: 'unavailable',
      page: 2,
    })
  ).toEqual({
    contractNumber: '9223372036854775807',
    state: 'Active',
    serviceType: 'electricity',
    profileId: id,
    cursor: id,
    contractId: id,
  });
  expect(
    staffContractsSearch({
      state: ['Active'],
      profileId: 'invalid',
      cursor: {},
      contractId: 'invalid',
    })
  ).toMatchObject({
    state: undefined,
    profileId: undefined,
    cursor: undefined,
    contractId: undefined,
  });
});
it('document links preserve staff defaults and an explicit All without allowing customer profile overrides or Removed', () => {
  expect(staffDocumentsSearch({})).toMatchObject({
    kind: 'standalone',
    state: 'SubmittedForReview',
  });
  expect(staffDocumentsSearch({ state: 'all', profileId: id })).toMatchObject({
    state: 'all',
    profileId: id,
  });
  expect(staffDocumentsSearch({ state: 'Removed' }).state).toBe('Removed');
  const customer = customerDocumentsSearch({
    q: ' Review ',
    kind: 'order',
    state: 'Removed',
    category: 'document',
    profileId: id,
    businessRecordId: id,
    documentId: id,
    cursor: id,
    reviewReason: 'private',
  });
  expect(customer).toMatchObject({
    q: 'Review',
    kind: 'order',
    state: undefined,
    category: 'document',
    businessRecordId: id,
    documentId: id,
    cursor: id,
  });
  expect(customer).not.toHaveProperty('profileId');
  expect(customer).not.toHaveProperty('reviewReason');
});
it('changing contract filters resets the cursor without dropping an independently selected ID', () => {
  const raw = staffContractsSearch({ state: 'Active', cursor: id, contractId: id });
  expect(
    writeListQuery(raw, staffContractQueryOptions, { filters: { state: 'Signed' } })
  ).toMatchObject({ cursor: undefined, contractId: id, state: 'Signed' });
});
