import { parseDateRangeFilter } from '@barghsa/shared/validation';
import { listChoice, listText, writeListQuery, type ListQueryOptions } from './list-query.js';

export const provinceQueryOptions: ListQueryOptions = {
  searchLimit: 100,
  filters: { status: listChoice(['active', 'inactive']) },
  sortFields: [],
  defaultSort: '',
  pageSizes: [20],
  defaultPageSize: 20,
  pagination: 'page',
};
export const cityQueryOptions: ListQueryOptions = { ...provinceQueryOptions, prefix: 'city_' };
export function geographySearch(raw: Record<string, unknown>) {
  const normalized = writeListQuery(
    writeListQuery({}, provinceQueryOptions, {}),
    cityQueryOptions,
    {}
  );
  const own = [...Object.keys(normalized), 'province'];
  const result = writeListQuery(
    writeListQuery(raw, provinceQueryOptions, {}),
    cityQueryOptions,
    {}
  );
  result.province = listText(128)(raw.province) || undefined;
  if (!result.province)
    for (const key of Object.keys(normalized)) if (key.startsWith('city_')) result[key] = undefined;
  return Object.fromEntries(own.map((key) => [key, result[key]]));
}
export function changeGeographySearch(
  current: Record<string, unknown>,
  next: Record<string, unknown>
) {
  const before = geographySearch(current),
    after = geographySearch(next);
  if (before.q !== after.q || before.status !== after.status) {
    return geographySearch({
      ...writeListQuery(after, cityQueryOptions, { search: '', filters: { status: '' }, page: 1 }),
      province: undefined,
    });
  }
  return after;
}

const date = (value: unknown) =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  parseDateRangeFilter(`${value}T00:00:00.000Z`, undefined)?.from
    ? value
    : '';
export const crmQueryOptions: ListQueryOptions = {
  searchLimit: 256,
  filters: {
    type: listChoice(['INDIVIDUAL', 'LEGAL']),
    verification: listChoice(['VERIFIED', 'UNVERIFIED', 'PENDING', 'DISABLED']),
    dateFrom: date,
    dateTo: date,
    staffOnly: (value) => (value === true || value === 'true' ? 'true' : ''),
  },
  sortFields: ['createdAt', 'lastLogin', 'username', 'profileCount'],
  defaultSort: 'createdAt',
  pageSizes: [20],
  defaultPageSize: 20,
  pagination: 'cursor',
};
export function crmSearch(raw: Record<string, unknown>) {
  const result = writeListQuery(raw, crmQueryOptions, {});
  if (
    typeof result.dateFrom === 'string' &&
    typeof result.dateTo === 'string' &&
    result.dateFrom > result.dateTo
  ) {
    result.dateFrom = undefined;
    result.dateTo = undefined;
  }
  const own = Object.keys(writeListQuery({}, crmQueryOptions, {}));
  return Object.fromEntries(own.map((key) => [key, result[key]]));
}
