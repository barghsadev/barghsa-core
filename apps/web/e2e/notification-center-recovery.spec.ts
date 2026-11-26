import { test, expect } from './coverage-fixture';
import type { Page, Route } from '@playwright/test';
import { t } from '@barghsa/i18n/app';
import { notificationCursor } from '../src/test/notification-inbox-fixtures';

const item = (title: string, id = '10000000-0000-4000-8000-000000000001') => ({
  id,
  type: 'payment.invoice_paid',
  titleI18nKey: '',
  bodyI18nKey: '',
  localizedContent: {
    en: { title, body: 'Payment received' },
    fa: { title, body: 'پرداخت دریافت شد' },
  },
  params: {},
  linkRoute: null,
  linkParams: null,
  isRead: false,
  readAt: null,
  createdAt: '2026-09-12T10:00:00Z',
});
const response = (title: string) => ({ data: [item(title)], next_cursor: null, unread_count: 1 });
test.use({ viewport: { width: 390, height: 844 } });
async function arrange(page: Page, locale: 'en' | 'fa') {
  await page.addInitScript((language) => localStorage.setItem('barghsa.locale', language), locale);
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({
      json: {
        userId: 'notification-customer',
        isStaff: false,
        operatingContext: 'customer',
        canSwitchContext: false,
        requiresTosAcceptance: false,
      },
    })
  );
  await page.route('**/api/v1/notifications/unread-count', (route) =>
    route.fulfill({ json: { unread_count: 1 } })
  );
}
async function paint(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
}
for (const locale of ['en', 'fa'] as const) {
  test(`an unread notification opens its own record without changing read state (${locale})`, async ({
    page,
  }) => {
    await arrange(page, locale);
    const record = { ...item('Transfer confirmed'), linkRoute: '/wallet' };
    let reads = 0;
    let marks = 0;
    let denied = false;
    const path = '/notifications/' + record.id;
    await page.route('**/api/v1/notifications?*', (route) =>
      route.fulfill({ json: { data: [record], next_cursor: null, unread_count: 1 } })
    );
    await page.route('**/api/v1' + path, (route) => {
      reads++;
      return denied
        ? route.fulfill({ status: 403, json: {} })
        : route.fulfill({
            json: { ...record, isRead: marks > 0, readAt: marks ? record.createdAt : null },
          });
    });
    await page.route('**/api/v1' + path + '/read', (route) => {
      marks++;
      return route.fulfill({ json: { id: record.id, is_read: true, unread_count: 0 } });
    });
    await page.goto('/notifications?filter=unread');
    const main = page.getByRole('main');
    await main.getByRole('link', { name: 'Transfer confirmed', exact: true }).click();
    await expect(page).toHaveURL(
      (url) => url.pathname === path && url.searchParams.get('filter') === 'unread'
    );
    await expect(main.getByRole('heading', { name: 'Transfer confirmed' })).toBeVisible();
    await expect(
      main.getByRole('link', { name: t('notifications.title', locale), exact: true })
    ).toHaveAttribute('href', '/notifications?filter=unread');
    await expect(
      main.getByRole('link', { name: t('notifications.record.openSubject', locale) })
    ).toHaveAttribute('href', '/wallet');
    expect(reads).toBe(1);
    expect(marks).toBe(0);
    const mark = main.getByRole('button', {
      name: t('notifications.markReadAria', locale),
      exact: true,
    });
    await mark.click();
    await expect(mark).toHaveCount(0);
    await expect(
      main.getByText(t('notifications.record.read', locale), { exact: true })
    ).toBeVisible();
    expect(marks).toBe(1);
    await page.reload();
    await expect(main.getByRole('heading', { name: 'Transfer confirmed' })).toBeVisible();
    denied = true;
    await page.reload();
    await expect(main.getByRole('alert')).toHaveText(t('notifications.record.unavailable', locale));
    await expect(main.getByRole('heading', { name: 'Transfer confirmed' })).toHaveCount(0);
    await expect(
      main.getByRole('link', { name: t('notifications.record.openSubject', locale) })
    ).toHaveCount(0);
  });

  test(`notification filters ignore stale pages and recover from loading errors (${locale})`, async ({
    page,
  }) => {
    await arrange(page, locale);
    let held: Route | undefined,
      first = true,
      failing = false;
    await page.route('**/api/v1/notifications?*', (route) => {
      const q = new URL(route.request().url()).searchParams;
      if (q.get('limit') === '10') return route.fulfill({ json: response('Bell notice') });
      if (q.get('filter') === 'unread') return route.fulfill({ json: response('Unread notice') });
      if (first) {
        first = false;
        held = route;
        return;
      }
      return failing
        ? route.fulfill({ status: 503, json: {} })
        : route.fulfill({ json: response('Current all notice') });
    });
    await page.goto('/notifications');
    await expect.poll(() => Boolean(held)).toBe(true);
    const loading = page.getByRole('main').locator('[data-slot="record-list-skeleton"]');
    await expect(loading).toBeVisible();
    await expect(loading.locator(':scope > div[aria-hidden="true"] > div')).toHaveCount(3);
    if (locale === 'fa') await page.screenshot({ path: '/tmp/notification-center-loading-fa.png' });
    const previous = held!.request();
    const cancelled = page.waitForEvent('requestfailed', (request) => request === previous);
    await page.getByRole('tab', { name: t('notifications.unread', locale), exact: true }).click();
    await expect(page.getByRole('button', { name: /Unread notice/ })).toBeVisible();
    await cancelled;
    await held!.fulfill({ json: response('Stale all notice') });
    await paint(page);
    await expect(page.getByRole('button', { name: /Unread notice/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Stale all notice/ })).toHaveCount(0);
    failing = true;
    await page
      .getByRole('tab', { name: t('notifications.bellLabel', locale), exact: true })
      .click();
    const error = page.getByRole('main').getByRole('alert');
    await expect(error).toBeVisible();
    failing = false;
    await error.getByRole('button', { name: t('notifications.retry', locale) }).click();
    const row = page.getByRole('link', { name: 'Current all notice', exact: true });
    await expect(row).toBeVisible();
    const badge = row.locator('span.bg-success-soft');
    await expect(badge.locator('svg.lucide-credit-card')).toBeVisible();
    await expect(badge).toContainText(t('notifications.type.payment', locale));
    await expect(badge).toHaveClass(/bg-success-soft/);
  });

  test(`unread notification clicks update optimistically and recover failed writes (${locale})`, async ({
    page,
  }) => {
    await arrange(page, locale);
    let read = false,
      held: Route | undefined,
      fail = true;
    await page.route('**/api/v1/notifications?*', (route) =>
      route.fulfill({
        json: {
          ...response('Pending notice'),
          data: read ? [] : [item('Pending notice')],
          unread_count: read ? 0 : 2,
          next_cursor: read ? null : notificationCursor(),
        },
      })
    );
    await page.route('**/api/v1/notifications/*/read', (route) => {
      if (fail) {
        held = route;
        return;
      }
      read = true;
      return route.fulfill({ json: { unread_count: 0 } });
    });
    await page.goto('/notifications');
    await page.getByRole('tab', { name: t('notifications.unread', locale), exact: true }).click();
    const row = page.getByRole('button', { name: /Pending notice/ });
    await row.click();
    await expect.poll(() => Boolean(held)).toBe(true);
    await expect(row).toHaveCount(0);
    await expect(page.getByRole('tab').first()).toBeDisabled();
    await held!.fulfill({ status: 503, json: {} });
    const error = page.getByRole('main').getByRole('alert');
    await expect(error).toBeVisible();
    await error.getByRole('button', { name: t('notifications.retry', locale) }).click();
    await expect(row).toBeVisible();
    fail = false;
    await row.click();
    await expect.poll(() => read).toBe(true);
    await expect(row).toHaveCount(0);
    await expect(page.getByRole('tab').first()).toBeEnabled();
    // The authoritative zero also covers another reader clearing the remaining page.
    await expect(
      page.getByRole('button', { name: t('notifications.loadMore', locale) })
    ).toHaveCount(0);
  });

  test(`bell rejects old counts during optimistic reads and restores failed actions (${locale})`, async ({
    page,
  }) => {
    await arrange(page, locale);
    let poll: Route | undefined,
      write: Route | undefined,
      fail = true,
      count = 2;
    const entries = [
      item('First notice'),
      item('Second notice', '10000000-0000-4000-8000-000000000002'),
    ];
    await page.route('**/api/v1/notifications/unread-count', (route) => {
      poll = route;
    });
    await page.route('**/api/v1/notifications?*', (route) =>
      route.fulfill({ json: { data: entries, next_cursor: null, unread_count: count } })
    );
    await page.route('**/api/v1/notifications/read-all', (route) => {
      if (fail) {
        write = route;
        return;
      }
      count = 0;
      return route.fulfill({ json: { marked: 2, unread_count: 0 } });
    });
    await page.goto('/notifications');
    const bell = page.getByTestId('notification-bell');
    const badge = bell.locator('.barghsa-notification-count');
    const announcement = bell.locator('..').locator(':scope > [role=status][aria-atomic=true]');
    const countLabel = (value: number) =>
      t('notifications.bellAria', locale).replace('{count}', value.toLocaleString(locale));
    const expectUnread = async (value: number) => {
      await expect(announcement).toHaveText(countLabel(value));
      await expect(bell).toHaveAttribute('aria-label', countLabel(value));
      if (value) await expect(badge).toHaveText(value.toLocaleString(locale));
      else await expect(badge).toHaveCount(0);
    };
    await bell.click();
    const panel = page.getByTestId('notification-panel');
    const markAll = panel.getByRole('button', {
      name: t('notifications.markAllRead', locale),
      exact: true,
    });
    await expect(markAll).toBeEnabled();
    await expectUnread(2);
    await markAll.click();
    await expect.poll(() => Boolean(poll && write)).toBe(true);
    await expectUnread(0);
    const completed = page.waitForResponse((r) => r.url().endsWith('/notifications/unread-count'));
    await poll!.fulfill({ json: { unread_count: 2 } });
    await (await completed).finished();
    await paint(page);
    await expectUnread(0);
    await write!.fulfill({ status: 503, json: {} });
    await expect(panel.getByRole('alert')).toBeVisible();
    await expectUnread(2);
    await panel.getByRole('button', { name: t('notifications.retry', locale) }).click();
    await expect(markAll).toBeEnabled();
    fail = false;
    await markAll.click();
    await expect.poll(() => count).toBe(0);
    await expectUnread(0);
    await expect(panel.getByRole('alert')).toHaveCount(0);
  });
}
