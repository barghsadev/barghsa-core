import { test, expect } from '@playwright/test';
import { ErrorCodes } from '@barghsa/shared/errors';
for (const locale of ['en', 'fa'])
  test(`job filters and retry failures preserve selection and current permissions (${locale})`, async ({
    page,
  }) => {
    const fa = locale === 'fa';
    await page.addInitScript((value) => {
      new MutationObserver(() => {
        if (document.documentElement) document.documentElement.lang = value;
      }).observe(document, { childList: true });
    }, locale);
    const jobs = Array.from({ length: 26 }, (_, index) => ({
      id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      jobType: index === 0 ? 'storage_cleanup' : 'auth_delivery',
      status: 'failed',
      error: 'Test transport failed',
      attempts: 5,
      maxAttempts: 5,
      lastRunAt: '2026-09-01T12:00:00Z',
      firstFailedAt: '2026-09-01T10:00:00Z',
      nextRunAt: null,
      resolvedAt: null,
      resolvedByUsername: null,
    }));
    let canView = true,
      canRetry = false,
      failLoad = true,
      verified = false,
      failSave = true;
    const queries: URLSearchParams[] = [],
      attempts: unknown[] = [];
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/admin/failed-jobs/access', (route) =>
      route.fulfill({ json: { canView, canRetry } })
    );
    await page.route('**/api/admin/failed-jobs?*', (route) => {
      const query = new URL(route.request().url()).searchParams;
      queries.push(query);
      return route.fulfill(
        failLoad
          ? { status: 503, json: {} }
          : {
              json:
                query.get('offset') === '25' || query.get('status') === 'dead_letter' ? [] : jobs,
            }
      );
    });
    await page.route('**/api/admin/failed-jobs/retry-bulk', (route) => {
      attempts.push(route.request().postDataJSON());
      if (!verified)
        return route.fulfill({
          status: 403,
          json: { error: { code: ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code } },
        });
      if (failSave) return route.fulfill({ status: 503, json: {} });
      canRetry = false;
      return route.fulfill({ json: [{ ...jobs[0], status: 'retrying' }] });
    });
    await page.route('**/api/auth/step-up', (route) => {
      verified = route.request().postDataJSON().password === 'correct-password';
      return route.fulfill({ status: verified ? 200 : 401, json: {} });
    });
    await page.goto('/admin/failed-jobs');
    await expect(page.getByRole('alert')).toBeVisible();
    failLoad = false;
    await page.getByRole('button', { name: fa ? 'تلاش مجدد' : 'Try again', exact: true }).click();
    await expect(page.locator('tbody tr')).toHaveCount(25);
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    await page.getByRole('button', { name: fa ? 'بعدی' : 'Next', exact: true }).click();
    await expect.poll(() => queries.at(-1)?.get('offset')).toBe('25');
    await expect(page.locator('tbody tr')).toHaveCount(0);
    await page.getByRole('button', { name: fa ? 'قبلی' : 'Previous', exact: true }).click();
    await expect(page.locator('tbody tr')).toHaveCount(25);
    await page.locator('#job-type').selectOption('storage_cleanup');
    await expect.poll(() => queries.at(-1)?.get('jobType')).toBe('storage_cleanup');
    await page
      .getByRole('button', { name: fa ? 'تلاش‌های پایان‌یافته' : 'Dead letter', exact: true })
      .click();
    await expect(page.locator('tbody tr')).toHaveCount(0);
    await page.getByRole('button', { name: fa ? 'ناموفق' : 'Failed', exact: true }).click();
    await expect(page.locator('tbody tr')).toHaveCount(25);
    canRetry = true;
    await page.getByRole('button', { name: fa ? 'تازه‌سازی' : 'Refresh', exact: true }).click();
    await page.locator('tbody tr').nth(0).getByRole('checkbox').check();
    await page.locator('tbody tr').nth(1).getByRole('checkbox').check();
    await page
      .getByRole('button', { name: fa ? /اجرای دوباره موارد انتخاب‌شده/ : /Retry selected/ })
      .click();
    const dialog = page.getByRole('dialog'),
      confirm = dialog.getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true });
    await expect(dialog).toContainText(fa ? 'پاک‌سازی فایل‌ها' : 'Storage cleanup');
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
    for (const value of attempts) expect(value).toEqual({ ids: [jobs[0]!.id, jobs[1]!.id] });
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    await expect(page.getByRole('status')).toContainText(
      fa ? '۱ مورد دیگر' : '1 selections were skipped'
    );
    canView = false;
    await page.getByRole('button', { name: fa ? 'تازه‌سازی' : 'Refresh', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(
      fa ? 'اجازه انجام' : 'do not have permission'
    );
    await expect(page.locator('tbody tr')).toHaveCount(0);
  });
