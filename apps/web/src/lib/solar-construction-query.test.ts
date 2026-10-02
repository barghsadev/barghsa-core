import { expect, it } from 'vitest';
import {
  solarConstructionQueryOptions,
  solarConstructionSearch,
} from './solar-construction-query.js';
import { parseListQuery, writeListQuery } from './list-query.js';
const id = '85000000-0000-4000-8000-000000000001';
it('restores only validated query/cursor/selection and preserves selection across criteria changes', () => {
  expect(
    solarConstructionSearch({ q: '  701 ', cursor: id, requestId: id, extra: 'ignored' })
  ).toEqual({ q: '701', cursor: id, requestId: id });
  expect(solarConstructionSearch({ q: ['701'], cursor: 'bad', requestId: 'bad' })).toEqual({
    q: undefined,
    cursor: undefined,
    requestId: undefined,
  });
  expect(solarConstructionSearch({ q: 'x'.repeat(201) }).q).toBeUndefined();
  expect(solarConstructionSearch({ q: 701 }).q).toBe('701');
  expect(solarConstructionSearch({ q: Number.MAX_SAFE_INTEGER + 1 }).q).toBeUndefined();
  const next = writeListQuery(
    { q: '701', cursor: id, requestId: id },
    solarConstructionQueryOptions,
    { search: '702' }
  );
  expect(solarConstructionSearch(next)).toEqual({ q: '702', cursor: undefined, requestId: id });
  expect(parseListQuery(next, solarConstructionQueryOptions).pageSize).toBe(50);
});
