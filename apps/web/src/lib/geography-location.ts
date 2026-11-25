import { cityQueryOptions, provinceQueryOptions } from './admin-list-query.js';
import { writeListQuery } from './list-query.js';

export type GeographySearch = Record<string, unknown>;

export function geographyId(value: unknown) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : undefined;
}

export function geographyListSearch(raw: GeographySearch) {
  const values = writeListQuery(raw, provinceQueryOptions, {});
  const keys = Object.keys(writeListQuery({}, provinceQueryOptions, {}));
  return Object.fromEntries(keys.map((key) => [key, values[key]]));
}

export function geographyRecordSearch(raw: GeographySearch) {
  const keys = Object.keys(writeListQuery({}, cityQueryOptions, {}));
  const values = writeListQuery(raw, cityQueryOptions, {});
  return {
    ...geographyListSearch(raw),
    ...Object.fromEntries(keys.map((key) => [key, values[key]])),
  };
}
