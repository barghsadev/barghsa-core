import { describe, expect, it } from 'vitest';
import { parseCatalogueListQuery } from './index.js';
describe('catalogue list query', () => {
  it('bounds pages and shares normalized defaults', () => {
    expect(
      parseCatalogueListQuery({
        type: 'hardware',
        search: '  برق_100%  ',
        status: 'archived',
        sort: 'price',
        order: 'asc',
        page: '2',
        limit: '50',
      })
    ).toEqual({
      type: 'hardware',
      search: 'برق_100%',
      status: 'archived',
      sort: 'price',
      order: 'asc',
      page: 2,
      limit: 50,
    });
    expect(parseCatalogueListQuery({})).toEqual({
      search: '',
      status: '',
      sort: 'createdAt',
      order: 'desc',
      page: 1,
      limit: 25,
    });
  });
  it.each([
    { page: '0' },
    { page: '1000001' },
    { page: '1e2' },
    { page: ['1', '2'] },
    { limit: '101' },
    { limit: '-1' },
    { status: ['active'] },
    { status: 'unknown' },
    { type: 'invalid' },
    { sort: 'price; DROP TABLE products' },
    { order: 'DESC NULLS FIRST' },
    { search: 'a'.repeat(201) },
    { search: ['x'] },
    { other: 'ignored?' },
  ])('rejects malformed input before query construction: %j', (raw) => {
    expect(parseCatalogueListQuery(raw)).toBeNull();
  });
});
