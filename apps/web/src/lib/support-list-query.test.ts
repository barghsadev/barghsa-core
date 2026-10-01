import { expect, it } from 'vitest';
import {
  consultationSearch,
  customerTicketsSearch,
  staffTicketsSearch,
  ticketQueryOptions,
  consultationQueryOptions,
} from './support-list-query.js';
import { writeListQuery } from '../hooks/useListQuery.js';
import { firstWork } from '../test/staff-business-fixtures.js';

it('retains supported ticket search/order/status/page and legacy customer scope links', () => {
  expect(
    customerTicketsSearch({
      q: ' Delivery ',
      order: 'asc',
      status: 'in_progress',
      page: '3',
      scope: 'active',
      ticketId: firstWork,
    })
  ).toEqual({
    q: 'Delivery',
    order: 'asc',
    status: 'in_progress',
    page: 3,
    scope: 'active',
    ticketId: firstWork,
  });
  expect(staffTicketsSearch({ scope: 'active', status: 'active' })).toMatchObject({
    status: 'active',
  });
  expect(Object.keys(staffTicketsSearch({ scope: 'active' }))).not.toContain('scope');
});
it.each([[], {}, -1, 'abc', 1000001])(
  'rejects invalid ticket page %s and unsupported parameters',
  (page) => {
    const parsed = customerTicketsSearch({
      page,
      q: ['secret'],
      order: 'reverse',
      status: 'bad',
      scope: 'other',
      ticketId: 'bad',
      sort: 'amount',
      pageSize: 100,
      cursor: firstWork,
    });
    expect(parsed).toEqual({
      page: undefined,
      q: undefined,
      order: undefined,
      status: undefined,
      ticketId: undefined,
      scope: undefined,
    });
  }
);
it('preserves every consultation criterion, including router-decoded numeric ages', () => {
  expect(
    consultationSearch({
      status: 'under_review',
      assignment: 'mine',
      priority: 'high',
      minAgeDays: 7,
      cursor: firstWork,
      requestId: firstWork,
    })
  ).toMatchObject({
    status: 'under_review',
    assignment: 'mine',
    priority: 'high',
    minAgeDays: '7',
    cursor: firstWork,
    requestId: firstWork,
  });
  expect(consultationSearch({ minAgeDays: ['7'], assignment: 'bad', cursor: 'bad' })).toMatchObject(
    { minAgeDays: undefined, assignment: undefined, cursor: undefined }
  );
});
it('resets only pagination on criteria changes and keeps selected records independent', () => {
  expect(
    staffTicketsSearch(
      writeListQuery({ page: 3, ticketId: firstWork }, ticketQueryOptions, {
        filters: { status: 'closed' },
      })
    )
  ).toMatchObject({ page: undefined, status: 'closed', ticketId: firstWork });
  expect(
    consultationSearch(
      writeListQuery({ cursor: firstWork, requestId: firstWork }, consultationQueryOptions, {
        filters: { priority: 'high' },
      })
    )
  ).toMatchObject({ cursor: undefined, priority: 'high', requestId: firstWork });
});
