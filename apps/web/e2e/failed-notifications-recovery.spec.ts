import { test, expect } from './coverage-fixture';

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
    const error = page
      .getByRole('alert')
      .filter({
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
