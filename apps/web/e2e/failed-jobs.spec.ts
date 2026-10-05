import { t } from '@barghsa/i18n/admin-ui';
import { crmShell } from './crm-shell-fixture';
import { formatBrowserDate } from './browser-date';
import { mockOppositeNumerals } from './number-preference-fixture';
import { test, expect } from './coverage-fixture';
import { ErrorCodes } from '@barghsa/shared/errors';
test.use({ viewport: { width: 390, height: 844 } });
for (const locale of ['en', 'fa'])
  test(`job filters and retry failures preserve selection and current permissions (${locale})`, async ({
    page,
  }) => {
    const fa = locale === 'fa';
    const jobs = Array.from({ length: 26 }, (_, index) => ({
      id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      jobType:
        index === 0
          ? 'storage_cleanup'
          : index === 1
            ? 'contract_activation'
            : index === 2
              ? 'contract_completion'
              : index === 3
                ? 'retired_job'
                : 'auth_delivery',
      status: 'failed',
      error: 'Test transport failed',
      errorCategory: 'transient',
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
    await crmShell(page, locale);
    await mockOppositeNumerals(page, locale);
    await page.route('**/api/user/settings/timezone', (route) =>
      route.fulfill({ json: { timezone: 'America/Los_Angeles' } })
    );
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
    await page.route('**/api/admin/failed-jobs/*', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const id = new URL(route.request().url()).pathname.split('/').at(-1);
      const selected = jobs.find((row) => row.id === id);
      return selected ? route.fulfill({ json: selected }) : route.fallback();
    });
    await page.route('**/api/auth/step-up', (route) => {
      verified = route.request().postDataJSON().password === 'correct-password';
      return route.fulfill({ status: verified ? 200 : 401, json: {} });
    });
    await page.goto('/admin/failed-jobs');
    await expect(page.getByRole('alert')).toBeVisible();
    failLoad = false;
    await page.getByRole('button', { name: fa ? 'تلاش مجدد' : 'Try again', exact: true }).click();
    await expect(
      page.locator(
        'table:visible > tbody > tr:has(th[scope=row]), ol[role=list]:visible > li:has(h2, h3)'
      )
    ).toHaveCount(25);
    await expect(
      page
        .locator(
          'table:visible > tbody > tr:has(th[scope=row]), ol[role=list]:visible > li:has(h2, h3)'
        )
        .nth(1)
    ).toContainText(fa ? 'فعال‌سازی قرارداد' : 'Contract activation');
    await expect(
      page
        .locator(
          'table:visible > tbody > tr:has(th[scope=row]), ol[role=list]:visible > li:has(h2, h3)'
        )
        .nth(2)
    ).toContainText(fa ? 'تکمیل دوره قرارداد' : 'Contract term completion');
    await expect(
      page
        .locator(
          'table:visible > tbody > tr:has(th[scope=row]), ol[role=list]:visible > li:has(h2, h3)'
        )
        .nth(3)
    ).toContainText('retired_job');
    await expect(
      page
        .locator(
          'table:visible > tbody > tr:has(th[scope=row]), ol[role=list]:visible > li:has(h2, h3)'
        )
        .first()
    ).toContainText(fa ? '5 / 5' : '۵ / ۵');
    await expect(
      page
        .locator(
          'table:visible > tbody > tr:has(th[scope=row]), ol[role=list]:visible > li:has(h2, h3)'
        )
        .first()
    ).toContainText(
      await formatBrowserDate(
        page,
        locale,
        {
          timeZone: 'America/Los_Angeles',
          dateStyle: 'medium',
          timeStyle: 'short',
        },
        jobs[0]!.firstFailedAt
      )
    );
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    await page.getByRole('button', { name: fa ? 'بعدی' : 'Next', exact: true }).click();
    await expect.poll(() => queries.at(-1)?.get('offset')).toBe('25');
    await expect(
      page.locator(
        'table:visible > tbody > tr:has(th[scope=row]), ol[role=list]:visible > li:has(h2, h3)'
      )
    ).toHaveCount(0);
    await page.getByRole('button', { name: fa ? 'قبلی' : 'Previous', exact: true }).click();
    await expect(
      page.locator(
        'table:visible > tbody > tr:has(th[scope=row]), ol[role=list]:visible > li:has(h2, h3)'
      )
    ).toHaveCount(25);
    await page.locator('#job-type').selectOption('storage_cleanup');
    await expect.poll(() => queries.at(-1)?.get('jobType')).toBe('storage_cleanup');
    await page
      .getByRole('button', { name: fa ? 'تلاش‌های پایان‌یافته' : 'Dead letter', exact: true })
      .click();
    await expect(
      page.locator(
        'table:visible > tbody > tr:has(th[scope=row]), ol[role=list]:visible > li:has(h2, h3)'
      )
    ).toHaveCount(0);
    await page.getByRole('button', { name: fa ? 'ناموفق' : 'Failed', exact: true }).click();
    await expect(
      page.locator(
        'table:visible > tbody > tr:has(th[scope=row]), ol[role=list]:visible > li:has(h2, h3)'
      )
    ).toHaveCount(25);
    canRetry = true;
    await page.getByRole('button', { name: fa ? 'تازه‌سازی' : 'Refresh', exact: true }).click();
    await page
      .locator(
        'table:visible > tbody > tr:has(th[scope=row]), ol[role=list]:visible > li:has(h2, h3)'
      )
      .nth(0)
      .getByRole('checkbox')
      .check();
    await page
      .locator(
        'table:visible > tbody > tr:has(th[scope=row]), ol[role=list]:visible > li:has(h2, h3)'
      )
      .nth(1)
      .getByRole('checkbox')
      .check();
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
    await expect(dialog).toContainText(t('admin.operationalReview.title', locale));
    await expect(confirm).toHaveCount(0);
    await dialog
      .getByRole('button', { name: t('admin.operationalReview.reviewed', locale), exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page
        .locator(
          'table:visible > tbody > tr:has(th[scope=row]), ol[role=list]:visible > li:has(h2, h3)'
        )
        .nth(1)
        .getByRole('checkbox')
    ).toBeEnabled();
    await page
      .locator(
        'table:visible > tbody > tr:has(th[scope=row]), ol[role=list]:visible > li:has(h2, h3)'
      )
      .nth(0)
      .getByRole('checkbox')
      .check();
    await page
      .locator(
        'table:visible > tbody > tr:has(th[scope=row]), ol[role=list]:visible > li:has(h2, h3)'
      )
      .nth(1)
      .getByRole('checkbox')
      .check();
    await page.getByRole('button', { name: t('admin.jobs.bulk', locale) }).click();
    failSave = false;
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: fa ? 'تازه‌سازی' : 'Refresh', exact: true })
    ).toBeFocused();
    expect(attempts).toHaveLength(3);
    for (const value of attempts) expect(value).toEqual({ ids: [jobs[0]!.id, jobs[1]!.id] });
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    await expect(
      page
        .locator('#admin-content')
        .getByRole('status')
        .filter({ hasText: fa ? '1 مورد دیگر' : '۱ selections were skipped' })
    ).toContainText(fa ? '1 مورد دیگر' : '۱ selections were skipped');
    canView = false;
    await page.getByRole('button', { name: fa ? 'تازه‌سازی' : 'Refresh', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(
      fa ? 'اجازه انجام' : 'do not have permission'
    );
    await expect(
      page.locator(
        'table:visible > tbody > tr:has(th[scope=row]), ol[role=list]:visible > li:has(h2, h3)'
      )
    ).toHaveCount(0);
  });
