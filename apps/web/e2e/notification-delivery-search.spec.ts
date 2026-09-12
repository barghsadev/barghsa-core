import { test, expect } from './coverage-fixture';
import AxeBuilder from '@axe-core/playwright';

for (const locale of ['en', 'fa'] as const) {
  test(`staff can search deliveries outside the dead-letter queue (${locale})`, async ({
    page,
  }) => {
    const fa = locale === 'fa';
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
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
    let mode: 'valid' | 'mismatch' | 'denied' | 'empty' = 'valid';
    const queries: URLSearchParams[] = [];
    await page.route('**/api/admin/notifications/delivery-logs?*', (route) => {
      const query = new URL(route.request().url()).searchParams;
      queries.push(query);
      if (mode === 'denied') return route.fulfill({ status: 403, json: {} });
      return route.fulfill({
        json:
          mode === 'empty'
            ? []
            : mode === 'mismatch'
              ? [{ ...entries[0], channel: 'sms' }]
              : query.get('notificationId') || query.get('offset') === '25'
                ? [entries[0]]
                : entries,
      });
    });
    await page.goto(fa ? '/admin/notifications' : '/admin/failed-notifications');
    await page.evaluate((lang) => {
      document.documentElement.lang = lang;
    }, locale);
    const browse = page.getByRole('button', {
      name: fa ? 'جست‌وجوی همه ارسال‌ها' : 'Search all deliveries',
      exact: true,
    });
    await browse.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('tbody tr')).toHaveCount(25);
    await expect(
      dialog.getByRole('columnheader', { name: fa ? 'نوبت پردازش' : 'Processing attempt' })
    ).toBeVisible();
    await expect(dialog).toContainText(fa ? 'بدون ارسال دوباره' : 'without sending again');
    expect(queries.at(-1)?.has('notificationId')).toBe(false);
    expect(queries.at(-1)?.has('channel')).toBe(false);
    await expect(dialog).toContainText(notificationId);
    expect(
      await new AxeBuilder({ page })
        .include('[role="dialog"]')
        .analyze()
        .then((r) => r.violations)
    ).toEqual([]);
    expect(await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
    await dialog.getByRole('button', { name: fa ? 'بعدی' : 'Next', exact: true }).click();
    await expect(dialog.locator('tbody tr')).toHaveCount(1);
    expect(queries.at(-1)?.get('offset')).toBe('25');
    const id = dialog.getByRole('textbox', { name: fa ? 'شناسه اعلان' : 'Notification ID' });
    await id.fill('invalid');
    const search = dialog.getByRole('button', { name: fa ? 'جست‌وجو' : 'Search', exact: true });
    const before = queries.length;
    await search.click();
    expect(await id.evaluate((e: HTMLInputElement) => e.validity.valid)).toBe(false);
    expect(queries).toHaveLength(before);
    await id.fill(notificationId.toUpperCase());
    await dialog
      .getByRole('combobox', { name: fa ? 'کانال' : 'Channel', exact: true })
      .selectOption('email');
    await dialog
      .getByRole('combobox', { name: fa ? 'نتیجه' : 'Outcome', exact: true })
      .selectOption('delivered');
    mode = 'mismatch';
    await search.click();
    const error = dialog.getByRole('alert');
    await expect(error).toBeVisible();
    await expect(dialog.locator('tbody tr')).toHaveCount(0);
    expect(queries.at(-1)?.get('offset')).toBe('0');
    expect(queries.at(-1)?.get('notificationId')).toBe(notificationId.toUpperCase());
    expect(queries.at(-1)?.get('channel')).toBe('email');
    expect(queries.at(-1)?.get('status')).toBe('delivered');
    mode = 'valid';
    await error.getByRole('button').click();
    await expect(dialog.locator('tbody tr')).toHaveCount(1);
    mode = 'denied';
    await search.click();
    await expect(error).toBeVisible();
    await expect(dialog.locator('tbody tr')).toHaveCount(0);
    mode = 'empty';
    await error.getByRole('button').click();
    await expect(dialog).toContainText(
      fa ? 'هیچ تلاش ارسالی ثبت نشده است.' : 'No delivery attempts have been recorded.'
    );
    await page.keyboard.press('Escape');
    await expect(browse).toBeFocused();
    canView = false;
    const reads = queries.length;
    await page.reload();
    await expect(
      page.getByRole('button', { name: /Search all deliveries|جست‌وجوی همه ارسال‌ها/ })
    ).toHaveCount(0);
    expect(queries).toHaveLength(reads);
  });
}
