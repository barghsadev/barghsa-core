import { expect, it } from 'vitest';
import { writeListQuery } from '../hooks/useListQuery.js';
import {
  deliveryHistoryQueryOptions,
  deliveryHistorySearch,
  failedJobQueryOptions,
  failedJobsSearch,
} from './operations-list-query.js';
import { notificationTemplatesSearch } from './template-catalogue-query.js';
import { failedNotificationPageSearch } from './notification-panel-query.js';

const notificationId = 'ABCDEF00-0000-4000-8000-000000000001';
it('restores job type, lifecycle status and page, excluding selection and private work', () => {
  expect(
    failedJobsSearch({
      jobType: 'storage_cleanup',
      status: 'dead_letter',
      page: '3',
      selected: ['private'],
      password: 'private',
      cursor: 'unsupported',
    })
  ).toEqual({ jobType: 'storage_cleanup', status: 'dead_letter', page: 3 });
});
it('keeps failed as the default and all as an explicit queue choice', () => {
  expect(failedJobsSearch({})).toEqual({ status: undefined, jobType: undefined, page: undefined });
  expect(failedJobsSearch({ status: 'all' }).status).toBe('all');
});
it.each([0, -1, '2.5', ['3'], 1_000_001])(
  'rejects unsupported pages across both operational lists: %s',
  (page) => {
    expect(failedJobsSearch({ page }).page).toBeUndefined();
    expect(deliveryHistorySearch({ history_page: page })).toEqual({});
  }
);
it('keeps delivery-history pagination independent of the stricter job API offset bound', () => {
  expect(failedJobsSearch({ page: 40_002 }).page).toBeUndefined();
  expect(deliveryHistorySearch({ history_page: 40_002 }).history_page).toBe(40_002);
  expect(deliveryHistorySearch({ history_page: 1_000_000 }).history_page).toBe(1_000_000);
});
it('accepts the largest page and resets job pagination on criteria changes', () => {
  expect(failedJobsSearch({ page: 40_001 }).page).toBe(40_001);
  expect(
    failedJobsSearch(
      writeListQuery({ status: 'all', page: 3 }, failedJobQueryOptions, {
        filters: { jobType: 'storage_cleanup' },
      })
    )
  ).toEqual({ status: 'all', jobType: 'storage_cleanup', page: undefined });
});
it('restores targeted history with exact UUID scope and clears an unrelated status filter', () => {
  expect(
    deliveryHistorySearch({
      history_mode: 'target',
      history_notificationId: notificationId,
      history_channel: 'email',
      history_status: 'failed',
      history_page: '2',
    })
  ).toEqual({
    history_mode: 'target',
    history_notificationId: notificationId,
    history_channel: 'email',
    history_page: 2,
  });
});
it('rejects arrays, unknown enums, job types and target history without its required scope', () => {
  expect(failedJobsSearch({ status: ['all'], jobType: 'unknown' })).toEqual({
    status: undefined,
    jobType: undefined,
    page: undefined,
  });
  expect(
    deliveryHistorySearch({
      history_mode: 'target',
      history_notificationId: ['invalid'],
      history_channel: 'push',
      history_status: ['delivered'],
    })
  ).toEqual({});
});
it('history criteria changes reset only history pagination and retain preview and queue scope', () => {
  const raw = {
    locale: 'fa',
    failed_status: 'all',
    failed_page: 3,
    preview_event: 'invoice.created',
    history_mode: 'all',
    history_page: 3,
    history_notificationId: notificationId,
    history_channel: 'email',
  };
  const next = writeListQuery(raw, deliveryHistoryQueryOptions, { filters: { status: 'sending' } });
  expect(notificationTemplatesSearch(next)).toEqual({
    locale: 'fa',
    channel: undefined,
    status: undefined,
    failed_status: 'all',
    failed_page: 3,
    preview_event: 'invoice.created',
    history_mode: 'all',
    history_notificationId: notificationId,
    history_channel: 'email',
    history_status: 'sending',
  });
  expect(failedNotificationPageSearch(next)).toEqual({
    failed_status: 'all',
    failed_channel: undefined,
    failed_severity: undefined,
    failed_page: 3,
    history_mode: 'all',
    history_notificationId: notificationId,
    history_channel: 'email',
    history_status: 'sending',
  });
});
it('history links exclude payloads, recipients, provider receipts, passwords and search drafts', () => {
  expect(
    deliveryHistorySearch({
      history_mode: 'all',
      history_notificationId: 'invalid',
      history_channel: 'sms',
      history_status: 'unknown',
      body: 'private',
      destination: '+989121234567',
      providerRef: 'private',
      password: 'private',
      history_draft: 'private',
    })
  ).toEqual({ history_mode: 'all', history_channel: 'sms', history_status: 'unknown' });
});
