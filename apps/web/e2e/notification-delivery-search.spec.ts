import { test, expect } from './coverage-fixture';
import AxeBuilder from '@axe-core/playwright';
import { t } from '@barghsa/i18n/admin-ui';
import { crmShell } from './crm-shell-fixture';
import { notificationTemplate } from '../src/test/content-catalogue-fixtures';

for (const locale of ['en', 'fa'] as const) {
  test(`staff can search deliveries outside the dead-letter queue (${locale})`, async ({
    page,
  }) => {
    const fa = locale === 'fa';
    await page.setViewportSize({ width: 390, height: 844 });
    await crmShell(page, locale);
    await page.route('**/api/admin/notifications/templates*', (route) =>
      route.fulfill({ json: [{ ...notificationTemplate(), locale }] })
    );
    await page.route('**/api/user/settings/timezone', (route) =>
      route.fulfill({ json: { timezone: 'UTC' } })
    );
    let canView = true;
    await page.route('**/api/admin/failed-notifications/access', (route) =>
      route.fulfill({ json: { canView, canRetry: false } })
    );
    await page.route('**/api/admin/failed-notifications?*', (route) => route.fulfill({ json: [] }));
    const notificationId = 'abcdef00-0000-4000-8000-000000000001';
    const entries = Array.from({ length: 26 }, (_, index) => ({
      id: `40000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      notificationId,
      channel: 'email',
      status: 'delivered',
      attemptNumber: index + 1,
      providerRef: 'accepted-reference',
      latencyMs: 30,
      errorCategory: null,
      errorDetail: null,
      createdAt: '2026-09-01T01:00:00Z',
    }));
    let mode: 'valid' | 'mismatch' | 'denied' | 'empty' | 'uncertain' = 'valid';
    const queries: URLSearchParams[] = [];
    await page.route('**/api/admin/notifications/delivery-logs?*', (route) => {
      const query = new URL(route.request().url()).searchParams;
      queries.push(query);
      if (mode === 'denied') return route.fulfill({ status: 403, json: {} });
      return route.fulfill({
        json:
          mode === 'uncertain'
            ? [{ ...entries[0], status: query.get('status'), providerRef: null, latencyMs: null }]
            : mode === 'empty'
              ? []
              : mode === 'mismatch'
                ? [{ ...entries[0], channel: 'sms' }]
                : query.get('notificationId') || query.get('offset') === '25'
                  ? [entries[0]]
                  : entries,
      });
    });
    await page.goto('/admin/failed-notifications/history');
    const history = page.getByRole('main');
    const cards = history.getByRole('list', {
      name: fa ? 'تاریخچه تلاش‌های ارسال' : 'Delivery attempt history',
      exact: true,
    });
    await expect(cards.getByRole('listitem')).toHaveCount(25);
    await expect(
      cards.getByText(fa ? 'نوبت پردازش' : 'Processing attempt', { exact: true })
    ).toHaveCount(25);
    await page.setViewportSize({ width: 1024, height: 844 });
    await expect(
      history
        .getByRole('table')
        .getByRole('columnheader', { name: fa ? 'نوبت پردازش' : 'Processing attempt' })
    ).toBeVisible();
    await expect(history.getByRole('table').locator('tbody tr')).toHaveCount(25);
    await expect(cards).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(cards.getByRole('listitem')).toHaveCount(25);
    expect(queries).toHaveLength(1);
    await expect(history).toContainText(fa ? 'بدون ارسال دوباره' : 'without sending again');
    expect(queries.at(-1)?.has('notificationId')).toBe(false);
    expect(queries.at(-1)?.has('channel')).toBe(false);
    await expect(history).toContainText(notificationId);
    expect(
      await new AxeBuilder({ page })
        .include('main')
        .analyze()
        .then((r) => r.violations)
    ).toEqual([]);
    expect(await history.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
    await history.getByRole('button', { name: fa ? 'بعدی' : 'Next', exact: true }).click();
    await expect(
      history.locator('table:visible tbody tr, [data-slot=card-list-view]:visible > li')
    ).toHaveCount(1);
    expect(queries.at(-1)?.get('offset')).toBe('25');
    const id = history.getByRole('textbox', { name: fa ? 'شناسه اعلان' : 'Notification ID' });
    await id.fill('invalid');
    const search = history.getByRole('button', { name: fa ? 'جست‌وجو' : 'Search', exact: true });
    const before = queries.length;
    await search.click();
    expect(await id.evaluate((e: HTMLInputElement) => e.validity.valid)).toBe(false);
    expect(queries).toHaveLength(before);
    await id.fill(notificationId.toUpperCase());
    await history
      .getByRole('combobox', { name: fa ? 'کانال' : 'Channel', exact: true })
      .selectOption('email');
    await history
      .getByRole('combobox', { name: fa ? 'نتیجه' : 'Outcome', exact: true })
      .selectOption('delivered');
    mode = 'mismatch';
    await search.click();
    const error = history.getByRole('alert');
    await expect(error).toBeVisible();
    await expect(
      history.locator('table:visible tbody tr, [data-slot=card-list-view]:visible > li')
    ).toHaveCount(0);
    expect(queries.at(-1)?.get('offset')).toBe('0');
    expect(queries.at(-1)?.get('notificationId')).toBe(notificationId.toUpperCase());
    expect(queries.at(-1)?.get('channel')).toBe('email');
    expect(queries.at(-1)?.get('status')).toBe('delivered');
    mode = 'valid';
    await error.getByRole('button').click();
    await expect(
      history.locator('table:visible tbody tr, [data-slot=card-list-view]:visible > li')
    ).toHaveCount(1);
    mode = 'uncertain';
    for (const [status, text] of [
      ['sending', fa ? 'آغاز شده؛ نتیجه ثبت نشده' : 'Started; outcome not recorded'],
      ['unknown', fa ? 'نتیجه نامشخص' : 'Outcome unknown'],
    ]) {
      await history
        .getByRole('combobox', { name: fa ? 'نتیجه' : 'Outcome', exact: true })
        .selectOption(status!);
      await search.click();
      await expect(
        history.locator('table:visible tbody tr, [data-slot=card-list-view]:visible > li')
      ).toHaveCount(1);
      await expect(cards.getByRole('listitem')).toContainText(text!);
      expect(queries.at(-1)?.get('status')).toBe(status);
    }
    mode = 'empty';
    const emptyMessage = fa
      ? 'هیچ تلاش ارسالی ثبت نشده است.'
      : 'No delivery attempts have been recorded.';
    await search.click();
    await expect(history).toContainText(emptyMessage);
    await page.reload();
    await expect(history).toContainText(emptyMessage);
    expect(new URL(page.url()).searchParams.get('history_notificationId')).toBe(
      notificationId.toUpperCase()
    );
    canView = false;
    mode = 'denied';
    const beforeDenial = queries.length;
    await search.click();
    await expect(search).toHaveCount(0);
    await expect(
      page.getByText(t('admin.notifications.deadLetter.accessDenied', locale), { exact: true })
    ).toBeVisible();
    expect(queries).toHaveLength(beforeDenial + 1);
    const reads = queries.length;
    await page.reload();
    await expect(history).toContainText(t('admin.notifications.deadLetter.accessDenied', locale));
    await expect(search).toHaveCount(0);
    expect(queries).toHaveLength(reads);
  });
}
