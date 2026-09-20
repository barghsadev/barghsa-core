import { test, expect } from './coverage-fixture';
import type { Page, Route } from '@playwright/test';
import { t } from '@barghsa/i18n/app';

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
async function arrange(page: Page, locale: 'en' | 'fa') {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript((language) => {
    const apply = () => {
      if (document.documentElement) document.documentElement.lang = language;
    };
    apply();
    new MutationObserver(apply).observe(document, { childList: true });
  }, locale);
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
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
    await page.getByRole('tab', { name: t('notifications.unread', locale), exact: true }).click();
    await expect(page.getByRole('button', { name: /Unread notice/ })).toBeVisible();
    const completed = page.waitForResponse(
      (r) => r.url().includes('limit=20') && new URL(r.url()).searchParams.get('filter') === 'all'
    );
    await held!.fulfill({ json: response('Stale all notice') });
    await (await completed).finished();
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
    const row = page.getByRole('button', { name: /Current all notice/ });
    await expect(row).toBeVisible();
    await expect(row.locator('svg.lucide-credit-card')).toBeVisible();
    await expect(row).toContainText(t('notifications.type.payment', locale));
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
          next_cursor: read ? null : 'older-page',
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
    await page.goto('/dashboard');
    const bell = page.getByTestId('notification-bell');
    await bell.click();
    const panel = page.getByTestId('notification-panel');
    const markAll = panel.getByRole('button', {
      name: t('notifications.markAllRead', locale),
      exact: true,
    });
    await expect(markAll).toBeEnabled();
    await markAll.click();
    await expect.poll(() => Boolean(poll && write)).toBe(true);
    await expect(bell.getByRole('status')).toHaveCount(0);
    const completed = page.waitForResponse((r) => r.url().endsWith('/notifications/unread-count'));
    await poll!.fulfill({ json: { unread_count: 2 } });
    await (await completed).finished();
    await paint(page);
    await expect(bell.getByRole('status')).toHaveCount(0);
    await write!.fulfill({ status: 503, json: {} });
    await expect(panel.getByRole('alert')).toBeVisible();
    await expect(bell.getByRole('status')).toBeVisible();
    await panel.getByRole('button', { name: t('notifications.retry', locale) }).click();
    await expect(markAll).toBeEnabled();
    fail = false;
    await markAll.click();
    await expect.poll(() => count).toBe(0);
    await expect(bell.getByRole('status')).toHaveCount(0);
    await expect(panel.getByRole('alert')).toHaveCount(0);
  });
}
