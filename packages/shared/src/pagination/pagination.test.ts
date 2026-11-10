import { describe, expect, it } from 'vitest';
import {
  cursorPaginationSchema,
  offsetPaginationQuerySchema,
  offsetPaginationSchema,
} from './index.js';

const cursor = '01900000-0000-7000-8000-000000000001';

describe('shared pagination schemas', () => {
  it('applies numeric defaults and accepts bounded cursors and offsets', () => {
    expect(cursorPaginationSchema.parse({})).toEqual({ limit: 20 });
    expect(offsetPaginationSchema.parse({})).toEqual({ limit: 20, offset: 0 });
    expect(cursorPaginationSchema.parse({ cursor, limit: 100 })).toEqual({ cursor, limit: 100 });
    expect(offsetPaginationSchema.parse({ offset: 10, limit: 1 })).toEqual({
      offset: 10,
      limit: 1,
    });
  });

  it.each([
    { cursor: 'invalid' },
    { cursor: [cursor] },
    { limit: '20' },
    { limit: 0 },
    { limit: 101 },
    { limit: 2.5 },
    { offset: 0 },
  ])('rejects an invalid cursor page %j', (input) => {
    expect(cursorPaginationSchema.safeParse(input).success).toBe(false);
  });

  it.each([
    { offset: -1 },
    { offset: '0' },
    { offset: Number.MAX_SAFE_INTEGER + 1 },
    { limit: 101 },
    { limit: 2.5 },
    { cursor },
  ])('rejects an invalid offset page %j', (input) => {
    expect(offsetPaginationSchema.safeParse(input).success).toBe(false);
  });

  const staffQuery = offsetPaginationQuerySchema(200);
  it('preserves the existing staff query bounds and omitted service defaults', () => {
    expect(staffQuery.parse({})).toEqual({});
    expect(staffQuery.parse({ limit: '200', offset: '1000000' })).toEqual({
      limit: 200,
      offset: 1_000_000,
    });
    expect(staffQuery.parse({ offset: '000' })).toEqual({ offset: 0 });
    expect(offsetPaginationQuerySchema().safeParse({ limit: '101' }).success).toBe(false);
  });

  it.each([
    { limit: '201' },
    { limit: '01' },
    { limit: '1e2' },
    { limit: ['10', '20'] },
    { limit: 10 },
    { offset: '-1' },
    { offset: '1.2' },
    { offset: '1000001' },
    { offset: { value: '0' } },
    { extra: 'rejected' },
  ])('rejects an abusive HTTP pagination query %j', (input) => {
    expect(staffQuery.safeParse(input).success).toBe(false);
  });
});
