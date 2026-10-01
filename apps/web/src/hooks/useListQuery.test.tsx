import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import {
  listPage,
  parseListQuery,
  writeListQuery,
  useListQuery,
  type ListQueryBinding,
} from './useListQuery.js';
import {
  provinceQueryOptions,
  cityQueryOptions,
  crmQueryOptions,
  geographySearch,
  crmSearch,
  changeGeographySearch,
} from '../lib/admin-list-query.js';

it.each([null, '', '-1', '1.5', '1e3', 'Infinity', [], {}, 0, 1000001, NaN])(
  'rejects invalid page %j',
  (value) => {
    expect(listPage(value)).toBe(1);
  }
);
it.each(['2', 2, '1000000', 1000000])('accepts bounded page %j', (value) => {
  expect(listPage(value)).toBe(Number(value));
});
it('allowlists sort, filters and sizes without accepting objects or arrays as text', () => {
  const query = parseListQuery(
    { q: {}, sort: 'sql', order: 'sql', status: [], page: '4', pageSize: '25', cursor: 'ignored' },
    provinceQueryOptions
  );
  expect(query).toMatchObject({
    search: '',
    sort: '',
    order: 'desc',
    filters: { status: '' },
    page: 4,
    pageSize: 20,
    cursor: '',
  });
  expect(parseListQuery({ q: 'x'.repeat(101) }, provinceQueryOptions).search).toBe('');
  expect(parseListQuery({ pageSize: [20] }, provinceQueryOptions).pageSize).toBe(20);
  const sizes = { ...provinceQueryOptions, pageSizes: [20, 50], defaultPageSize: 50 };
  expect(parseListQuery({ pageSize: [20] }, sizes).pageSize).toBe(50);
  expect(parseListQuery({ pageSize: '20' }, sizes).pageSize).toBe(20);
});
it('changes one list while preserving the other list and unrelated route context', () => {
  const raw = {
    q: 'Province',
    page: 3,
    city_q: 'City',
    city_page: 5,
    city_status: 'active',
    province: 'selected',
  };
  expect(writeListQuery(raw, cityQueryOptions, { filters: { status: 'inactive' } })).toMatchObject({
    q: 'Province',
    page: 3,
    city_q: 'City',
    city_page: undefined,
    city_status: 'inactive',
    province: 'selected',
  });
  expect(writeListQuery(raw, provinceQueryOptions, { page: 4 })).toMatchObject({
    page: 4,
    city_page: 5,
  });
});
it.each([provinceQueryOptions, crmQueryOptions])(
  'sanitizes invalid UI updates while retaining unrelated scope (%j)',
  (options) => {
    const raw = { otherPage: 7, profileId: 'kept' };
    const result = writeListQuery(raw, options, {
      search: 'x'.repeat(1001),
      sort: 'unknown',
      order: 'asc',
      page: -7,
      pageSize: 999,
      cursor: 'x'.repeat(4097),
      filters: { status: 'unknown', verification: 'unknown' },
    });
    expect(result).toMatchObject({
      ...raw,
      q: undefined,
      sort: undefined,
      order: 'asc',
      page: undefined,
      pageSize: undefined,
      cursor: undefined,
    });
    expect(parseListQuery(result, options)).toMatchObject({
      search: '',
      sort: options.defaultSort,
      order: 'asc',
      page: 1,
      pageSize: options.defaultPageSize,
      cursor: '',
    });
  }
);
it('clears cursors when criteria change but keeps exact opaque cursors for pagination', () => {
  const raw = { q: 'Customer', verification: 'PENDING', cursor: 'opaque+/=token' };
  expect(parseListQuery(raw, crmQueryOptions).cursor).toBe('opaque+/=token');
  expect(parseListQuery({ cursor: ' exact opaque cursor ' }, crmQueryOptions).cursor).toBe(
    ' exact opaque cursor '
  );
  expect(writeListQuery(raw, crmQueryOptions, { sort: 'username' }).cursor).toBeUndefined();
  expect(writeListQuery(raw, crmQueryOptions, { cursor: 'next' })).toMatchObject({
    q: 'Customer',
    verification: 'PENDING',
    cursor: 'next',
  });
});
it('normalizes invalid dates and removes orphaned city state or unsupported URL fields', () => {
  expect(
    geographySearch({ city_q: 'orphan', city_page: 7, status: 'invented', admin: true })
  ).toMatchObject({ city_q: undefined, city_page: undefined, status: undefined });
  expect(geographySearch({ admin: true })).not.toHaveProperty('admin');
  expect(
    crmSearch({ dateFrom: '2026-02-30', dateTo: '2026-04-01', staffOnly: true, sort: 'sql' })
  ).toMatchObject({
    dateFrom: undefined,
    dateTo: '2026-04-01',
    staffOnly: 'true',
    sort: undefined,
  });
  expect(crmSearch({ dateFrom: '2026-04-01', dateTo: '2026-03-01' })).toMatchObject({
    dateFrom: undefined,
    dateTo: undefined,
  });
});
it('clears expanded city scope in the same parent-filter navigation and allows equal calendar dates', () => {
  const before = { q: 'Old', province: 'selected', city_q: 'City', city_page: 4 };
  expect(changeGeographySearch(before, { ...before, q: 'New' })).toMatchObject({
    q: 'New',
    province: undefined,
    city_q: undefined,
    city_page: undefined,
  });
  expect(
    crmSearch({ dateFrom: '2026-03-01', dateTo: '2026-03-01', staffOnly: true })
  ).toMatchObject({ dateFrom: '2026-03-01', dateTo: '2026-03-01', staffOnly: 'true' });
});

let host: HTMLDivElement, root: Root, binding: ListQueryBinding;
let external!: (value: Record<string, unknown>) => void;
const changes: Record<string, unknown>[] = [];
function Harness({
  initial = {},
  cursor = false,
}: {
  initial?: Record<string, unknown>;
  cursor?: boolean;
}) {
  const [raw, setRaw] = useState(initial);
  external = setRaw;
  binding = useListQuery(cursor ? crmQueryOptions : provinceQueryOptions, raw, (change) => {
    setRaw((current) => {
      const next = change(current);
      changes.push(next);
      return next;
    });
  });
  return <output>{JSON.stringify(binding.query)}</output>;
}
beforeEach(() => {
  vi.useFakeTimers();
  changes.length = 0;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});
it('does not issue an initial search or undo a restored page, then commits one debounced search', async () => {
  await act(async () => root.render(<Harness initial={{ q: 'Saved', page: 3 }} />));
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(changes).toEqual([]);
  expect(binding.query.page).toBe(3);
  await act(async () => binding.setSearchInput('Next'));
  await act(async () => vi.advanceTimersByTimeAsync(299));
  expect(changes).toEqual([]);
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(binding.query).toMatchObject({ search: 'Next', page: 1 });
  expect(changes).toHaveLength(1);
  expect(binding.params.get('search')).toBe('Next');
});
it('cancels pending typing when history changes even with the same applied search', async () => {
  await act(async () => root.render(<Harness initial={{ q: 'Saved', status: 'active' }} />));
  await act(async () => binding.setSearchInput('Obsolete'));
  await act(async () => external({ q: 'Saved', status: 'inactive', page: 4 }));
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(changes).toEqual([]);
  expect(binding.searchInput).toBe('Saved');
  expect(binding.query).toMatchObject({ page: 4, filters: { status: 'inactive' } });
});
it('applies pending search together with a chosen filter instead of losing either change', async () => {
  await act(async () => root.render(<Harness initial={{ page: 3 }} />));
  await act(async () => binding.setSearchInput('Pending'));
  await act(async () => binding.setQuery({ filters: { status: 'inactive' } }));
  expect(binding.query).toMatchObject({
    search: 'Pending',
    filters: { status: 'inactive' },
    page: 1,
  });
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(changes).toHaveLength(1);
});
it('does not invent a previous page for a restored cursor and rejects repeated cursor cycles', async () => {
  await act(async () => root.render(<Harness cursor initial={{ cursor: 'restored' }} />));
  expect(binding.hasPrevious).toBe(false);
  await act(async () => binding.next('next'));
  expect(binding.hasPrevious).toBe(true);
  expect(binding.canAdvance('restored')).toBe(false);
  await act(async () => binding.next('restored'));
  expect(binding.query.cursor).toBe('next');
  await act(async () => binding.previous());
  expect(binding.query.cursor).toBe('restored');
  await act(async () => binding.setQuery({ filters: { verification: 'PENDING' } }));
  expect(binding.query.cursor).toBe('');
  expect(binding.hasPrevious).toBe(false);
});
it('clear cancels pending typing and restores defaults without altering another list', async () => {
  await act(async () => root.render(<Harness initial={{ q: 'Saved', page: 4, city_q: 'Kept' }} />));
  await act(async () => binding.setSearchInput('Pending'));
  await act(async () => binding.clear());
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(binding.query).toMatchObject({ search: '', page: 1, filters: { status: '' } });
  expect(changes).toHaveLength(1);
  expect(changes[0]?.city_q).toBe('Kept');
});
