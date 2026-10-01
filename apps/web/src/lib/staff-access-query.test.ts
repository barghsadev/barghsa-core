import { expect, it } from 'vitest';
import { writeListQuery } from '../hooks/useListQuery.js';
import {
  roleComparisonQueryOptions,
  roleComparisonSearch,
  staffDirectorySearch,
} from './staff-access-query.js';
it('restores directory pages independently of local creation and permission drafts', () => {
  expect(
    staffDirectorySearch({
      page: '3',
      userId: 'private',
      password: 'private',
      reason: 'private',
      roleIds: ['role'],
      draft: 'private',
    })
  ).toEqual({ page: 3 });
});
it.each([null, [], ['3'], 0, '-1', '2.5', '1e3', 1_000_001])(
  'rejects malformed directory pages: %j',
  (page) => {
    expect(staffDirectorySearch({ page })).toEqual({});
  }
);
it('keeps the shared page bound independent of failed-job API limits', () => {
  expect(staffDirectorySearch({ page: 40_002 })).toEqual({ page: 40_002 });
  expect(staffDirectorySearch({ page: 1_000_000 })).toEqual({ page: 1_000_000 });
  expect(staffDirectorySearch({ page: 1 })).toEqual({});
});
it('restores safe role modules and leaves effective-permission lookup drafts local', () => {
  expect(
    roleComparisonSearch({
      module: 'finance',
      staffUserId: 'private',
      password: 'private',
      page: 3,
    })
  ).toEqual({ module: 'finance' });
  expect(
    roleComparisonSearch(
      writeListQuery({ module: 'finance' }, roleComparisonQueryOptions, { filters: { module: '' } })
    )
  ).toEqual({});
});
it.each([[], '<script>', 'finance:write', 'x'.repeat(81), 'finance scope'])(
  'rejects malformed role module selectors: %j',
  (module) => {
    expect(roleComparisonSearch({ module })).toEqual({});
  }
);
