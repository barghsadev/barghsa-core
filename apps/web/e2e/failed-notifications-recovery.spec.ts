import { test, expect } from './coverage-fixture';
import AxeBuilder from '@axe-core/playwright';

const row = {
  id: '10000000-0000-4000-8000-000000000001',
  outboxId: '20000000-0000-4000-8000-000000000001',
  jobId: '30000000-0000-4000-8000-000000000001',
  eventKey: 'invoice.created',
  channel: 'email',
  severity: 'error',
  status: 'open',
  cause: 'Provider unavailable',
  attempts: 5,
  maxAttempts: 5,
  createdAt: '2026-09-01T01:00:00Z',
  recipientKey: 'ab...yz',
  data: { token: '***' },
  resolvedById: null,
  resolvedAt: null,
  errorCategory: 'transient',
};

for (const locale of ['en', 'fa'] as const) {
  const fa = locale === 'fa';
  test(`delivery history is scoped, paginated, accessible and recovers (${locale})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/user/settings/timezone', (route) =>
      route.fulfill({ json: { timezone: 'UTC' } })
    );
    await page.route('**/api/admin/failed-notifications/access', (route) =>
      route.fulfill({ json: { canView: true, canRetry: false } })
    );
    await page.route('**/api/admin/failed-notifications?*', (route) =>
      route.fulfill({ json: [row] })
    );
    const entries = Array.from({ length: 26 }, (_, index) => ({
      id: `40000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      notificationId: row.outboxId,
      channel: 'email',
      status: index === 0 ? 'delivered' : 'failed',
      attemptNumber: 26 - index,
      providerRef: index === 0 ? 'receipt-26' : null,
      latencyMs: 125,
      errorCategory: index === 0 ? null : 'transient',
      errorDetail: index === 0 ? null : '<img src=x onerror=alert(1)> token=***',
      createdAt: row.createdAt,
    }));
    let mode: 'unavailable' | 'wrong-record' | 'valid' | 'empty' = 'unavailable';
    const queries: URLSearchParams[] = [];
    await page.route('**/api/admin/notifications/delivery-logs?*', (route) => {
      const query = new URL(route.request().url()).searchParams;
      queries.push(query);
      if (mode === 'unavailable') return route.fulfill({ status: 403, json: {} });
      return route.fulfill({
        json:
          mode === 'wrong-record'
            ? [{ ...entries[0], notificationId: row.jobId }]
            : mode === 'empty'
              ? []
              : query.get('offset') === '25'
                ? [entries[25]]
                : entries,
      });
    });
    await page.goto(fa ? '/admin/notifications' : '/admin/failed-notifications');
    await page.evaluate((lang) => {
      document.documentElement.lang = lang;
    }, locale);
    await page
      .locator('summary')
      .filter({ hasText: fa ? 'جزئیات پوشانده‌شده' : 'Masked details' })
      .click();
    const history = page.getByRole('button', {
      name: fa ? 'تاریخچه تلاش‌های ارسال' : 'Delivery attempt history',
      exact: true,
    });
    await history.click();
    const dialog = page.getByRole('dialog');
    const error = dialog.getByRole('alert');
    await expect(error).toBeVisible();
    mode = 'wrong-record';
    await error.getByRole('button').click();
    await expect(error).toBeVisible();
    await expect(dialog.locator('tbody tr')).toHaveCount(0);
    mode = 'valid';
    await error.getByRole('button').click();
    await expect(dialog.locator('tbody tr')).toHaveCount(25);
    await expect(dialog).toContainText('receipt-26');
    await expect(dialog).toContainText('<img src=x onerror=alert(1)> token=***');
    await expect(dialog.locator('img')).toHaveCount(0);
    expect(
      await new AxeBuilder({ page })
        .include('[role="dialog"]')
        .analyze()
        .then((result) => result.violations)
    ).toEqual([]);
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
      true
    );
    await dialog.getByRole('button', { name: fa ? 'بعدی' : 'Next', exact: true }).click();
    await expect(dialog.locator('tbody tr')).toHaveCount(1);
    expect(queries.at(-1)?.get('offset')).toBe('25');
    await dialog.getByRole('button', { name: fa ? 'قبلی' : 'Previous', exact: true }).click();
    await expect(dialog.locator('tbody tr')).toHaveCount(25);
    for (const query of queries) {
      expect(query.get('notificationId')).toBe(row.outboxId);
      expect(query.get('channel')).toBe('email');
      expect(query.get('limit')).toBe('26');
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(history).toBeFocused();
    mode = 'empty';
    await history.click();
    await expect(dialog).toContainText(
      fa ? 'هیچ تلاش ارسالی ثبت نشده است.' : 'No delivery attempts have been recorded.'
    );
  });
  test(`failed notification reads reject malformed authority and rows (${locale})`, async ({
    page,
  }) => {
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    let access: unknown = { canView: 'false', canRetry: 'false' };
    let data: unknown = [row];
    let reads = 0;
    await page.route('**/api/admin/failed-notifications/access', (route) =>
      route.fulfill({ json: access })
    );
    await page.route('**/api/admin/failed-notifications?*', (route) => {
      reads++;
      return route.fulfill({ json: data });
    });
    await page.goto('/admin/failed-notifications');
    await page.evaluate((lang) => {
      document.documentElement.lang = lang;
    }, locale);
    const reload = page.getByRole('button', { name: fa ? 'تازه‌سازی' : 'Refresh', exact: true });
    const error = page.getByRole('alert').filter({
      hasText: fa ? 'خطا در بارگذاری صف پیام‌های ناموفق' : 'Failed to load dead-letter queue',
    });
    await expect(error).toBeVisible();
    expect(reads).toBe(0);
    access = { canView: true, canRetry: true };
    for (const malformed of [
      [null],
      [{ ...row, id: '../other' }],
      [{ ...row, channel: ['email'] }],
      [{ ...row, attempts: '5' }],
      [{ ...row, createdAt: 'bad date' }],
      [{ ...row, data: [] }],
      [row, row],
    ]) {
      data = malformed;
      await reload.click();
      await expect(reload).toBeEnabled();
      await expect(error).toBeVisible();
      await expect(page.locator('tbody tr')).toHaveCount(0);
    }
    data = [row];
    await reload.click();
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(error).toHaveCount(0);
  });

  for (const kind of ['retry', 'resolve', 'dismiss'] as const) {
    test(`failed notification ${kind} requires exact acknowledgment (${locale})`, async ({
      page,
    }) => {
      await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
      await page.route('**/api/admin/failed-notifications/access', (route) =>
        route.fulfill({ json: { canView: true, canRetry: true } })
      );
      let saved = false;
      const status = { retry: 'retried', resolve: 'resolved', dismiss: 'dismissed' }[kind];
      const acknowledged = {
        ...row,
        status,
        resolvedById: 'staff',
        resolvedAt: '2026-09-09T01:00:00Z',
      };
      await page.route('**/api/admin/failed-notifications?*', (route) =>
        route.fulfill({ json: saved ? [] : [row] })
      );
      const responses = [
        null,
        { ...acknowledged, id: row.outboxId },
        { ...acknowledged, jobId: row.outboxId },
        { ...acknowledged, status: 'open' },
        acknowledged,
      ];
      let calls = 0;
      await page.route(`**/api/admin/failed-notifications/${row.id}/${kind}`, (route) => {
        expect(route.request().method()).toBe('POST');
        const response = responses[calls++];
        saved = calls === responses.length;
        return route.fulfill({ json: response });
      });
      await page.goto('/admin/failed-notifications');
      await page.evaluate((lang) => {
        document.documentElement.lang = lang;
      }, locale);
      const label = fa
        ? { retry: 'تلاش مجدد', resolve: 'حل‌شده', dismiss: 'بستن' }[kind]
        : { retry: 'Retry', resolve: 'Resolve', dismiss: 'Dismiss' }[kind];
      await page.getByRole('button', { name: `${label} ${row.eventKey}`, exact: true }).click();
      const dialog = page.getByRole('dialog');
      const confirm = dialog.getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true });
      for (let index = 0; index < responses.length - 1; index++) {
        await confirm.click();
        await expect(dialog.getByRole('alert')).toBeVisible();
        await expect(page.locator('tbody tr')).toHaveCount(1);
      }
      await confirm.click();
      await expect(dialog).toHaveCount(0);
      await expect(page.locator('tbody tr')).toHaveCount(0);
      expect(calls).toBe(responses.length);
    });
  }
}
