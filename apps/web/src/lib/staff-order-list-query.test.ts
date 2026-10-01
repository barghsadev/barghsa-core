import { expect, it } from 'vitest';
import {
  electricityOrdersSearch,
  savingOrdersSearch,
  electricityQueueOptions,
} from './staff-order-list-query.js';
import { writeListQuery } from '../hooks/useListQuery.js';
import { firstWork, olderWork } from '../test/staff-business-fixtures.js';

it.each([electricityOrdersSearch, savingOrdersSearch])(
  'rejects malformed order/cursor links and unsupported list fields',
  (parse) => {
    expect(
      parse({
        orderId: 'other',
        cursor: ['x'],
        sort: 'amount',
        page: 20,
        pageSize: 100,
        q: 'secret',
        lane: 'bad',
        view: 'bad',
      })
    ).toEqual(expect.objectContaining({ orderId: undefined, cursor: undefined }));
    expect(Object.keys(parse({ q: 'secret' }))).not.toContain('q');
    expect(parse({ orderId: firstWork, cursor: olderWork })).toMatchObject({
      orderId: firstWork,
      cursor: olderWork,
    });
  }
);
it('keeps selected order independent of pagination and resets the page when the queue changes', () => {
  const raw = { view: 'review', orderId: firstWork, cursor: olderWork };
  expect(electricityOrdersSearch({ ...raw, orderId: olderWork })).toMatchObject({
    view: 'review',
    cursor: olderWork,
    orderId: olderWork,
  });
  expect(
    electricityOrdersSearch(
      writeListQuery(raw, electricityQueueOptions, { filters: { view: 'conversations' } })
    )
  ).toMatchObject({ view: 'conversations', cursor: undefined });
});
