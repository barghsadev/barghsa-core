import { test, expect } from './coverage-fixture';
for (const locale of ['en', 'fa'])
  test(`reconciliation handles paging, denied access and failed actions (${locale})`, async ({
    page,
  }) => {
    const fa = locale === 'fa';
    await page.addInitScript((value) => {
      new MutationObserver(() => {
        if (document.documentElement) document.documentElement.lang = value;
      }).observe(document, { childList: true });
    }, locale);
    let fail = true,
      canView = true,
      canResolve = false;
    const queries: string[] = [];
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/user/settings/timezone', (route) =>
      route.fulfill({ json: { timezone: 'America/Los_Angeles' } })
    );
    await page.route('**/api/admin/reconciliation/items**', (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/access')) return route.fulfill({ json: { canView, canResolve } });
      if (route.request().method() === 'POST')
        return route.fulfill({ status: 409, json: { error: 'CONFLICT:STATE' } });
      queries.push(url.search);
      if (fail) return route.fulfill({ status: 503, json: {} });
      const offset = Number(url.searchParams.get('offset'));
      return route.fulfill({
        json: Array.from({ length: offset ? 1 : 25 }, (_, index) => ({
          id: `10000000-0000-4000-8000-${String(offset + index).padStart(12, '0')}`,
          description: `Mismatch ${offset + index}`,
          exceptionType: 'wallet_mismatch',
          status: 'open',
          severity: 'high',
          createdAt: '2026-09-01T00:00:00Z',
          details: { ledger: '9007199254740993' },
          assignedToUsername: null,
          resolutionNote: null,
        })),
      });
    });
    await page.goto('/admin/reconciliation');
    await expect(page.getByRole('alert')).toContainText(fa ? 'دریافت مغایرت‌ها' : 'Could not load');
    fail = false;
    await page.getByRole('button', { name: fa ? 'تلاش مجدد' : 'Retry', exact: true }).click();
    await expect(page.locator('tbody tr').first()).toContainText(
      new Intl.DateTimeFormat(locale, {
        timeZone: 'America/Los_Angeles',
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date('2026-09-01T00:00:00Z'))
    );
    await page.getByRole('button', { name: 'Mismatch 0', exact: true }).click();
    await expect(
      page
        .getByRole('dialog')
        .getByRole('button', { name: fa ? 'شروع بررسی' : 'Investigate', exact: true })
    ).toHaveCount(0);
    await page
      .getByRole('button', { name: fa ? 'بستن جزئیات' : 'Close details', exact: true })
      .click();
    await page.getByRole('button', { name: fa ? 'بعدی' : 'Next', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Mismatch 25', exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: fa ? 'بعدی' : 'Next', exact: true })
    ).toBeDisabled();
    expect(queries.some((query) => query.includes('offset=25'))).toBe(true);
    canResolve = true;
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
    await page.getByRole('button', { name: 'Mismatch 0', exact: true }).click();
    await page.getByLabel(fa ? 'توضیح' : 'Explanation', { exact: true }).fill('Review note');
    await page.getByRole('button', { name: fa ? 'رفع مغایرت' : 'Resolve', exact: true }).click();
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
    canView = false;
    await page
      .getByRole('button', { name: fa ? 'اعمال فیلترها' : 'Apply filters', exact: true })
      .click();
    await expect(page.getByRole('alert')).toContainText(fa ? 'اجازه مشاهده' : 'permission to view');
    await expect(page.getByRole('table')).toHaveCount(0);
  });
