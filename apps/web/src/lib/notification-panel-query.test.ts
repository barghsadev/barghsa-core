import { expect, it } from 'vitest';
import { writeListQuery } from '../hooks/useListQuery.js';
import { notificationTemplatesSearch } from './template-catalogue-query.js';
import {
  failedNotificationQueryOptions,
  failedNotificationsSearch,
  notificationPanelSearch,
  previewQueryOptions,
} from './notification-panel-query.js';

it('keeps catalogue, preview and failed-message filters independent and drops private work', () => {
  const raw = {
    locale: 'fa',
    channel: 'sms',
    status: 'draft',
    preview_event: 'invoice.created',
    preview_channel: 'in_app',
    preview_locale: 'en',
    preview_version: 'template-2',
    failed_status: 'all',
    failed_channel: 'email',
    failed_severity: 'critical',
    failed_page: 3,
    password: 'private',
    bodyTemplate: 'private',
    recipientKey: 'private',
  };
  const {
    password: _password,
    bodyTemplate: _body,
    recipientKey: _recipient,
    ...publicCriteria
  } = raw;
  expect(notificationTemplatesSearch(raw)).toEqual(publicCriteria);
});
it('keeps the default open queue distinct from all statuses', () => {
  expect(failedNotificationsSearch({}).failed_status).toBeUndefined();
  expect(failedNotificationsSearch({ failed_status: 'all' }).failed_status).toBe('all');
  expect(
    failedNotificationsSearch(
      writeListQuery({}, failedNotificationQueryOptions, { filters: { status: 'all' } })
    ).failed_status
  ).toBe('all');
});
it.each([0, -1, '2.5', ['3'], 40_002, 1_000_000])(
  'rejects pages outside the server offset contract: %s',
  (failed_page) => {
    expect(failedNotificationsSearch({ failed_page }).failed_page).toBeUndefined();
  }
);
it('restores the largest supported offset without permitting another page', () => {
  expect(failedNotificationsSearch({ failed_page: '40001' }).failed_page).toBe(40_001);
});
it('resets only queue pagination when queue criteria change', () => {
  const raw = {
    failed_status: 'all',
    failed_page: 3,
    preview_event: 'invoice.created',
    preview_version: 'v2',
    locale: 'fa',
  };
  const next = notificationTemplatesSearch(
    writeListQuery(raw, failedNotificationQueryOptions, { filters: { severity: 'critical' } })
  );
  expect(next).toMatchObject({
    failed_status: 'all',
    failed_severity: 'critical',
    preview_event: 'invoice.created',
    preview_version: 'v2',
    locale: 'fa',
  });
  expect(next.failed_page).toBeUndefined();
});
it('preview reset preserves queue pagination and catalogue scope', () => {
  const raw = {
    failed_page: 3,
    channel: 'email',
    preview_event: 'invoice.created',
    preview_channel: 'email',
    preview_locale: 'fa',
    preview_version: 'v2',
  };
  const next = notificationTemplatesSearch(
    writeListQuery(raw, previewQueryOptions, {
      filters: { event: '', channel: '', locale: '', version: '' },
    })
  );
  expect(next).toEqual({ failed_page: 3, locale: undefined, channel: 'email', status: undefined });
});
it('rejects array filters, unsupported enums and oversized identifiers', () => {
  expect(
    notificationPanelSearch({
      preview_event: ['invoice.created'],
      preview_channel: 'push',
      preview_locale: 'de',
      preview_version: 'x'.repeat(201),
      failed_status: ['all'],
      failed_channel: 'push',
      failed_severity: 'warning',
      failed_page: ['2'],
    })
  ).toEqual({});
});
