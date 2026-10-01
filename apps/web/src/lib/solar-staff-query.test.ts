import { expect, it } from 'vitest';
import { writeListQuery } from '../hooks/useListQuery.js';
import { firstSolar, olderSolar } from '../test/solar-staff-fixtures.js';
import {
  solarPostalSearch,
  solarDocumentsSearch,
  solarPostalQueryOptions,
  solarRequestsQueryOptions,
  solarFilesQueryOptions,
} from './solar-staff-query.js';

it('keeps independent request/file cursors and excludes private review and configuration', () => {
  const raw = {
    requests_cursor: firstSolar,
    files_cursor: olderSolar,
    reason: 'private',
    fa: 'draft',
    password: 'secret',
    selected: firstSolar,
  };
  expect(solarDocumentsSearch(raw)).toEqual({
    requests_cursor: firstSolar,
    files_cursor: olderSolar,
  });
  expect(
    solarDocumentsSearch(writeListQuery(raw, solarRequestsQueryOptions, { cursor: olderSolar }))
  ).toEqual({ requests_cursor: olderSolar, files_cursor: olderSolar });
  expect(solarDocumentsSearch(writeListQuery(raw, solarFilesQueryOptions, { cursor: '' }))).toEqual(
    { requests_cursor: firstSolar, files_cursor: undefined }
  );
});
it('restores postal lane and resets only its cursor when changing criteria', () => {
  const raw = { lane: 'all', cursor: firstSolar, reason: 'private' };
  expect(solarPostalSearch(raw)).toEqual({ lane: 'all', cursor: firstSolar });
  expect(
    solarPostalSearch(
      writeListQuery(raw, solarPostalQueryOptions, { filters: { lane: 'waiting_customer' } })
    )
  ).toEqual({ lane: 'waiting_customer', cursor: undefined });
  expect(
    solarPostalSearch(
      writeListQuery(raw, solarPostalQueryOptions, { filters: { lane: 'needs_staff' } })
    )
  ).toEqual({ lane: undefined, cursor: undefined });
});
it.each([null, [], [firstSolar], 1, 'not-a-uuid', ' '.repeat(4097)])(
  'rejects malformed solar cursor %j',
  (cursor) => {
    expect(solarPostalSearch({ cursor })).toEqual({ lane: undefined, cursor: undefined });
    expect(solarDocumentsSearch({ requests_cursor: cursor, files_cursor: firstSolar })).toEqual({
      requests_cursor: undefined,
      files_cursor: firstSolar,
    });
  }
);
it.each([null, [], ['all'], 'closed', '<script>'])(
  'uses the default postal lane for invalid %j',
  (lane) => {
    expect(solarPostalSearch({ lane })).toEqual({ lane: undefined, cursor: undefined });
  }
);
