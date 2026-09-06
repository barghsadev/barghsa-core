import { test, expect } from '@playwright/test';
const user = {
  userId: 'user-one',
  username: 'person@example.test',
  registrationDate: '2026-08-01T00:00:00.000001Z',
  lastLogin: null,
  profileCount: 1,
  hasVerifiedProfile: false,
  profiles: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      profileType: 'INDIVIDUAL',
      status: 'PENDING_VERIFICATION',
      title: 'Example profile',
    },
  ],
};
for (const locale of ['en', 'fa'])
  test(`CRM filters, profile links and cursor navigation (${locale})`, async ({ page }) => {
    await page.addInitScript((value) => {
      new MutationObserver(() => {
        if (document.documentElement) document.documentElement.lang = value;
      }).observe(document, { childList: true });
    }, locale);
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    const requests: URL[] = [];
    await page.route('**/api/crm/users?*', (route) => {
      const url = new URL(route.request().url());
      requests.push(url);
      return route.fulfill({
        json: {
          users: url.searchParams.get('cursor') ? [] : [user],
          cursor: url.searchParams.get('cursor') ? null : 'page-two',
          hasMore: !url.searchParams.get('cursor'),
        },
      });
    });
    await page.goto('/admin/crm?verification=PENDING');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      locale === 'fa' ? 'کاربران مدیریت مشتریان' : 'CRM users'
    );
    await expect(page.getByRole('heading', { name: user.username })).toBeVisible();
    expect(requests.at(-1)!.searchParams.get('verification')).toBe('PENDING');
    await page
      .getByRole('button', { name: locale === 'fa' ? 'پروفایل‌ها: 1' : 'Profiles: 1' })
      .click();
    await expect(page.getByRole('link', { name: /Example profile/ })).toHaveAttribute(
      'href',
      `/admin/crm/profiles/${user.profiles[0]!.id}`
    );
    await page
      .getByRole('button', { name: locale === 'fa' ? 'بستن همه' : 'Collapse all', exact: true })
      .click();
    await expect(page.getByRole('link', { name: /Example profile/ })).toHaveCount(0);
    await page
      .getByRole('button', { name: locale === 'fa' ? 'بعدی' : 'Next', exact: true })
      .click();
    await expect(
      page.getByText(locale === 'fa' ? 'کاربری با این مشخصات پیدا نشد.' : 'No matching users.')
    ).toBeVisible();
    expect(requests.at(-1)!.searchParams.get('cursor')).toBe('page-two');
    await page.locator('#crm-type').selectOption('LEGAL');
    await expect(page.getByRole('heading', { name: user.username })).toBeVisible();
    expect(requests.at(-1)!.searchParams.has('cursor')).toBe(false);
    await page.locator('#crm-search').fill('Example');
    await expect.poll(() => requests.at(-1)!.searchParams.get('search')).toBe('Example');
    await page
      .getByRole('button', {
        name: locale === 'fa' ? 'پاک کردن فیلترها' : 'Clear filters',
        exact: true,
      })
      .click();
    await expect.poll(() => requests.at(-1)!.searchParams.has('verification')).toBe(false);
  });
test('CRM access errors remain errors and can be retried', async ({ page }) => {
  await page.addInitScript(() => {
    new MutationObserver(() => {
      if (document.documentElement) document.documentElement.lang = 'en';
    }).observe(document, { childList: true });
  });
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  let allowed = false;
  await page.route('**/api/crm/users?*', (route) =>
    route.fulfill(
      allowed ? { json: { users: [], cursor: null, hasMore: false } } : { status: 403, json: {} }
    )
  );
  await page.goto('/admin/crm');
  await expect(page.getByRole('alert')).toContainText('Check your access');
  allowed = true;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByText('No matching users.')).toBeVisible();
});
test('Persian picker uses Jalali month boundaries and sends Gregorian API dates', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-03-21T12:00:00Z') });
  await page.addInitScript(() => {
    new MutationObserver(() => {
      if (document.documentElement) document.documentElement.lang = 'fa';
    }).observe(document, { childList: true });
  });
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  const requests: URL[] = [];
  await page.route('**/api/crm/users?*', (route) => {
    requests.push(new URL(route.request().url()));
    return route.fulfill({ json: { users: [], cursor: null, hasMore: false } });
  });
  await page.goto('/admin/crm');
  await page.getByRole('combobox', { name: 'ثبت‌نام از', exact: true }).click();
  const calendar = page.locator('[data-slot="calendar"]');
  await expect(calendar).toContainText('فروردین');
  const firstDay = calendar
    .getByRole('button', { name: /فروردین.*۱.*۱۴۰۵|۱.*فروردین.*۱۴۰۵/ })
    .first();
  await firstDay.click();
  await expect.poll(() => requests.at(-1)?.searchParams.get('dateFrom')).toBe('2026-03-21');
  await expect(page.getByRole('combobox', { name: 'ثبت‌نام از', exact: true })).toContainText(
    '۱ فروردین ۱۴۰۵'
  );
});
test('Jalali leap-day selection and keyboard dismissal preserve the date', async ({ page }) => {
  await page.clock.install({ time: new Date('2025-03-20T12:00:00Z') });
  await page.addInitScript(() => {
    new MutationObserver(() => {
      if (document.documentElement) document.documentElement.lang = 'fa';
    }).observe(document, { childList: true });
  });
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  const requests: URL[] = [];
  await page.route('**/api/crm/users?*', (route) => {
    requests.push(new URL(route.request().url()));
    return route.fulfill({ json: { users: [], cursor: null, hasMore: false } });
  });
  await page.goto('/admin/crm');
  const trigger = page.getByRole('combobox', { name: 'ثبت‌نام تا', exact: true });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const calendar = page.locator('[data-slot="calendar"]');
  await expect(calendar).toContainText('اسفند');
  await calendar.getByRole('button', { name: /۳۰.*اسفند.*۱۴۰۳|اسفند.*۳۰.*۱۴۰۳/ }).click();
  await expect
    .poll(() => requests.at(-1)?.searchParams.get('dateTo'))
    .toBe('2025-03-20T23:59:59.999999Z');
  await trigger.click();
  await page.keyboard.press('Escape');
  await expect(calendar).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(trigger).toContainText('۳۰ اسفند ۱۴۰۳');
});
