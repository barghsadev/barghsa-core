import { formatBrowserDate } from './browser-date';
import { test, expect } from './coverage-fixture';
import { t } from '@barghsa/i18n/admin-ui';
for (const locale of ['en', 'fa'] as const)
  test(`reconciliation handles paging, denied access and failed actions (${locale})`, async ({
    page,
  }) => {
    const fa = locale === 'fa';
    const word = (key: string) => t(`admin.reconciliation.${key}`, locale);
    const row = (index: number) => ({
      id: `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      description: `Mismatch ${index}`,
      exceptionType: 'wallet_mismatch',
      status: 'open',
      severity: 'high',
      createdAt: '2026-09-01T00:00:00Z',
      details: { ledger: '9007199254740993' },
      assignedToUsername: null,
      resolvedByUsername: null,
      resolutionNote: null,
    });
    await page.addInitScript((value) => localStorage.setItem('barghsa.locale', value), locale);
    let fail = true,
      canView = true,
      canResolve = false;
    const queries: string[] = [];
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/auth/user', (route) =>
      route.fulfill({
        json: {
          userId: 'finance',
          isStaff: true,
          operatingContext: 'staff',
          canSwitchContext: false,
          requiresTosAcceptance: false,
        },
      })
    );
    await page.route('**/api/user/settings/timezone', (route) =>
      route.fulfill({ json: { timezone: 'America/Los_Angeles' } })
    );
    await page.route('**/api/admin/reconciliation/items**', (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/access')) return route.fulfill({ json: { canView, canResolve } });
      if (route.request().method() === 'POST')
        return route.fulfill({ status: 409, json: { error: 'CONFLICT:STATE' } });
      if (url.pathname.endsWith(row(0).id)) return route.fulfill({ json: row(0) });
      if (url.searchParams.get('limit') === '1') return route.fulfill({ json: [] });
      queries.push(url.search);
      if (fail) return route.fulfill({ status: 503, json: {} });
      const offset = Number(url.searchParams.get('offset'));
      return route.fulfill({
        json: Array.from({ length: offset ? 1 : 25 }, (_, index) => row(offset + index)),
      });
    });
    await page.goto('/admin/reconciliation');
    await expect(page.getByRole('alert')).toContainText(fa ? 'دریافت مغایرت‌ها' : 'Could not load');
    fail = false;
    await page.getByRole('button', { name: fa ? 'تلاش مجدد' : 'Retry', exact: true }).click();
    const first = page.getByRole('link', { name: 'Mismatch 0', exact: true });
    await first.click();
    await expect(page).toHaveURL(new RegExp(`/admin/reconciliation/${row(0).id}`));
    const record = page.getByTestId('reconciliation-record');
    await expect(record.locator('time')).toContainText(
      await formatBrowserDate(
        page,
        locale,
        {
          timeZone: 'America/Los_Angeles',
          dateStyle: 'medium',
          timeStyle: 'short',
        },
        '2026-09-01T00:00:00Z'
      )
    );
    await expect(
      record.getByRole('button', { name: word('investigate'), exact: true })
    ).toHaveCount(0);
    await expect(record.getByRole('link', { name: word('resolve'), exact: true })).toHaveCount(0);
    await page.goto(`/admin/reconciliation/${row(0).id}/resolve`);
    await expect(record.getByRole('status').filter({ hasText: word('denied') })).toBeVisible();
    await expect(record.locator('#rex-note')).toHaveCount(0);
    await page.getByRole('link', { name: word('backToCase'), exact: true }).click();
    const back = page.getByRole('link', { name: word('backToQueue'), exact: true });
    await back.click();
    await page.getByRole('button', { name: fa ? 'بعدی' : 'Next', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Mismatch 25', exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: fa ? 'بعدی' : 'Next', exact: true })
    ).toBeDisabled();
    expect(queries.some((query) => query.includes('offset=25'))).toBe(true);
    canResolve = true;
    await page
      .getByRole('button', { name: fa ? 'تازه‌سازی مغایرت‌ها' : 'Refresh exceptions', exact: true })
      .click();
    await expect(first).toBeVisible();
    const beforeInvalid = queries.length;
    await page
      .getByLabel(fa ? 'تاریخ ایجاد از' : 'Created from', { exact: true })
      .fill('2026-03-08T02:30');
    await page
      .getByLabel(fa ? 'تاریخ ایجاد تا پیش از' : 'Created before', { exact: true })
      .fill('2026-03-08T04:30');
    await page
      .getByRole('button', { name: fa ? 'اعمال فیلترها' : 'Apply filters', exact: true })
      .click();
    await expect(page.getByRole('alert')).toBeVisible();
    expect(queries).toHaveLength(beforeInvalid);

    await page
      .getByLabel(fa ? 'تاریخ ایجاد از' : 'Created from', { exact: true })
      .fill('2026-09-01T00:00');
    await page
      .getByLabel(fa ? 'تاریخ ایجاد تا پیش از' : 'Created before', { exact: true })
      .fill('2026-09-03T00:00');
    await page
      .getByRole('button', { name: fa ? 'اعمال فیلترها' : 'Apply filters', exact: true })
      .click();
    await expect
      .poll(() => new URLSearchParams(queries.at(-1)).get('createdFrom'))
      .toBe('2026-09-01T07:00:00.000Z');
    expect(new URLSearchParams(queries.at(-1)).get('createdBefore')).toBe(
      '2026-09-03T07:00:00.000Z'
    );
    await first.click();
    await record.getByRole('link', { name: word('resolve'), exact: true }).click();
    await page.getByLabel(word('resolutionNote'), { exact: true }).fill('Review note');
    await record.getByRole('button', { name: word('reviewResolution'), exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true })
      .click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
      fa ? 'این مغایرت تغییر کرده' : 'This exception changed'
    );
    await page
      .getByRole('dialog')
      .getByRole('button', { name: fa ? 'انصراف' : 'Cancel', exact: true })
      .click();
    await expect(record.locator('#rex-note')).toHaveValue('Review note');
    await page.getByRole('link', { name: word('backToCase'), exact: true }).click();
    await back.click();
    canView = false;
    await page
      .getByRole('button', { name: fa ? 'تازه‌سازی مغایرت‌ها' : 'Refresh exceptions', exact: true })
      .click();
    await expect(page.getByRole('alert')).toContainText(fa ? 'اجازه مشاهده' : 'permission to view');
    await expect(page.getByRole('table')).toHaveCount(0);
    await expect(first).toHaveCount(0);
  });
