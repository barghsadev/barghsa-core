import { expect, it } from 'vitest';
import { writeListQuery } from '../hooks/useListQuery.js';
import { giftListSearch, giftQueryOptions, giftFilter } from './gift-list-query.js';
const id = 'ABCDEF00-0000-4000-8000-000000000001';
it('restores all applied promotion criteria and scoped usage selection', () => {
  expect(
    giftListSearch({
      search: ' CODE ',
      status: 'inactive',
      discountType: 'percentage',
      eligibility: 'profile',
      expiry: 'expired',
      cursor: id,
      selected: id,
    })
  ).toEqual({
    search: 'CODE',
    status: 'inactive',
    discountType: 'percentage',
    eligibility: 'profile',
    expiry: 'expired',
    cursor: id.toLowerCase(),
    selected: id.toLowerCase(),
  });
});
it('excludes private edits, receipts and unsupported query fields', () => {
  expect(
    giftListSearch({
      selected: 'new',
      password: 'private',
      code: 'PRIVATE',
      discountValue: '3000',
      profileIds: [id],
      reason: 'private',
      sort: 'code',
      page: 8,
    })
  ).toEqual({ selected: 'new' });
});
it.each([['array'], 'invalid', ' ' + id, id + ' ', 7])(
  'rejects malformed cursor and record scope: %s',
  (value) => {
    expect(giftListSearch({ cursor: value, selected: value })).toEqual({});
  }
);
it('rejects invalid choices and oversized searches instead of broadening a draft silently', () => {
  expect(
    giftListSearch({
      search: 'x'.repeat(65),
      status: ['active'],
      discountType: 'invalid',
      eligibility: 'everyone',
      expiry: 'soon',
    })
  ).toEqual({});
});
it('criteria changes reset cursors while selection remains independent of pagination', () => {
  const raw = { search: 'CODE', cursor: id, selected: id };
  expect(
    giftListSearch(writeListQuery(raw, giftQueryOptions, { filters: { status: 'inactive' } }))
  ).toEqual({ search: 'CODE', status: 'inactive', selected: id.toLowerCase() });
});
it('sends only applied filters with escaped text and leaves selection out of the API query', () => {
  expect(
    Object.fromEntries(
      new URLSearchParams(giftFilter({ search: 'A&B', status: '', discountType: 'fixed_irr' }))
    )
  ).toEqual({ search: 'A&B', discountType: 'fixed_irr' });
});
