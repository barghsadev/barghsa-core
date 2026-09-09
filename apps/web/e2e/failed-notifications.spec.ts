import { formatBrowserDate } from './browser-date';
import { test, expect } from './coverage-fixture';
import { ErrorCodes } from '@barghsa/shared/errors';
for (const locale of ['en', 'fa'])
  test(`notification triage handles permissions, paging and step-up failures (${locale})`, async ({
    page,
  }) => {
    const fa = locale === 'fa';
    await page.addInitScript((value) => {
      if (document.documentElement) document.documentElement.lang = value;
      new MutationObserver(() => {
        if (document.documentElement) document.documentElement.lang = value;
      }).observe(document, { childList: true });
    }, locale);
    const rows = Array.from({ length: 26 }, (_, index) => ({
      id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      outboxId: `20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      jobId: `30000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      eventKey: `test.event.${index}`,
      channel: 'email',
      severity: 'error',
      status: 'open',
      cause: 'Test provider failure',
      attempts: 5,
      maxAttempts: 5,
      createdAt: '2026-09-01T01:00:00Z',
      recipientKey: 'ab...yz',
      data: { token: '***' },
      resolvedById: null,
      resolvedAt: null,
      errorCategory: 'transient',
    }));
    let canView = true,
      canRetry = false,
      failLoad = true,
      verified = false,
      failSave = true;
    const attempts: string[] = [],
      queries: URLSearchParams[] = [];
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/user/settings/timezone', (route) =>
      route.fulfill({ json: { timezone: 'America/Los_Angeles' } })
    );
    await page.route('**/api/admin/failed-notifications/access', (route) =>
      route.fulfill({ json: { canView, canRetry } })
    );
    await page.route('**/api/admin/failed-notifications?*', (route) => {
      const query = new URL(route.request().url()).searchParams;
      queries.push(query);
      return route.fulfill(
        failLoad ? { status: 503, json: {} } : { json: query.get('offset') === '25' ? [] : rows }
      );
    });
    await page.route('**/api/admin/failed-notifications/*/retry', (route) => {
      attempts.push(route.request().url());
      if (!verified)
        return route.fulfill({
          status: 403,
          json: { error: { code: ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code } },
        });
      if (failSave) return route.fulfill({ status: 503, json: {} });
      canRetry = false;
      return route.fulfill({ json: { ...rows[0], status: 'retried' } });
    });
    await page.route('**/api/auth/step-up', (route) => {
      verified = route.request().postDataJSON().password === 'correct-password';
      return route.fulfill({ status: verified ? 200 : 401, json: {} });
    });
    await page.goto('/admin/failed-notifications');
    await expect(page.getByRole('alert')).toBeVisible();
    failLoad = false;
    await page.getByRole('button', { name: fa ? 'تلاش مجدد' : 'Try again', exact: true }).click();
    await expect(page.locator('tbody tr')).toHaveCount(25);
    await expect(page.locator('tbody tr').first()).toContainText(
      await formatBrowserDate(
        page,
        locale,
        {
          timeZone: 'America/Los_Angeles',
          dateStyle: 'medium',
          timeStyle: 'short',
        },
        rows[0]!.createdAt
      )
    );
    await expect(page.locator('tbody button:visible')).toHaveCount(0);
    await page.getByRole('button', { name: fa ? 'بعدی' : 'Next', exact: true }).click();
    await expect(page.locator('tbody tr')).toHaveCount(0);
    await expect.poll(() => queries.at(-1)?.get('offset')).toBe('25');
    await page.getByRole('button', { name: fa ? 'قبلی' : 'Previous', exact: true }).click();
    await expect(page.locator('tbody tr')).toHaveCount(25);
    await page.getByLabel(fa ? 'کانال' : 'Channel', { exact: true }).selectOption('sms');
    await expect.poll(() => queries.at(-1)?.get('channel')).toBe('sms');
    await page.getByLabel(fa ? 'شدت' : 'Severity', { exact: true }).selectOption('critical');
    await expect.poll(() => queries.at(-1)?.get('severity')).toBe('critical');
    canRetry = true;
    await page.getByRole('button', { name: fa ? 'تازه‌سازی' : 'Refresh', exact: true }).click();
    await page
      .getByRole('button', { name: `${fa ? 'تلاش مجدد' : 'Retry'} test.event.0`, exact: true })
      .click();
    const dialog = page.getByRole('dialog'),
      confirm = dialog.getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true });
    await expect(dialog).toContainText('ab...yz');
    await confirm.click();
    const password = dialog.locator('input[type="password"]');
    await password.fill('wrong');
    await confirm.click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await password.fill('correct-password');
    await confirm.click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    failSave = false;
    await password.fill('correct-password');
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    expect(attempts).toHaveLength(3);
    expect(new Set(attempts).size).toBe(1);
    await expect(page.locator('tbody button:visible')).toHaveCount(0);
    await expect(page.locator('#admin-content').getByRole('status')).toContainText(
      fa ? 'تحویل هنوز' : 'Delivery is not yet confirmed'
    );
    canView = false;
    await page.getByRole('button', { name: fa ? 'تازه‌سازی' : 'Refresh', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(fa ? 'دسترسی غیرمجاز' : 'Access denied');
    await expect(page.locator('tbody tr')).toHaveCount(0);
  });
