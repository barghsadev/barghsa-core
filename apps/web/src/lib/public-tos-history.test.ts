import { expect, it } from 'vitest';
import { readPublicTosHistory } from './public-tos-history.js';
const row = {
  id: '00000000-0000-4000-8000-000000000001',
  versionId: 'v1',
  publishedAt: '2026-11-06T00:00:00Z',
};
it('projects only public metadata and preserves an empty or final page', () => {
  expect(
    readPublicTosHistory({
      versions: [{ ...row, createdBy: 'private', contentFa: 'private draft' }],
      nextCursor: null,
    })
  ).toEqual({ versions: [row], nextCursor: null });
  expect(readPublicTosHistory({ versions: [], nextCursor: null })).toEqual({
    versions: [],
    nextCursor: null,
  });
});
it.each([
  { versions: [row, row], nextCursor: null },
  { versions: [row], nextCursor: '00000000-0000-4000-8000-000000000002' },
  { versions: [], nextCursor: row.id },
  { versions: [{ ...row, publishedAt: null }], nextCursor: null },
  { versions: [{ ...row, publishedAt: 'not a date' }], nextCursor: null },
  { versions: [{ ...row, id: '../private' }], nextCursor: null },
  { versions: [row] },
])('refuses invalid, duplicated or unbound history metadata %#', (value) => {
  expect(readPublicTosHistory(value)).toBeNull();
});
