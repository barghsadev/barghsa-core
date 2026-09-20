import { test, expect } from './coverage-fixture';
import AxeBuilder from '@axe-core/playwright';

const roles = [
  {
    roleId: 'role-customer-support',
    name: 'Customer Support',
    description: 'Tickets only',
    permissions: ['tickets:read'],
    predefined: true,
  },
];
const result = (userId: string) => ({
  userId,
  isAdmin: false,
  roleIds: ['role-customer-support'],
  roleNames: ['Customer Support'],
  permissions: [{ permission: 'tickets:read', group: 'tickets' }],
  isWildcard: false,
});

for (const locale of ['en', 'fa'] as const) {
  test(`roles reject malformed lists and recover (${locale})`, async ({ page }) => {
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    let valid = false;
    await page.route('**/api/admin/roles', (route) => route.fulfill({ json: valid ? roles : {} }));
    await page.goto('/admin/roles');
    await page.evaluate((lang) => {
      document.documentElement.lang = lang;
    }, locale);
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: locale === 'fa' ? 'خطا در بارگذاری نقش‌ها' : 'Failed to load roles' })
    ).toBeVisible();
    valid = true;
    await page
      .getByRole('button', { name: locale === 'fa' ? 'تلاش مجدد' : 'Retry', exact: true })
      .click();
    const checkbox = page.getByRole('checkbox', { name: 'tickets:read', exact: true });
    await expect(checkbox).toBeVisible();
    await expect(checkbox).toBeChecked();
    await expect(checkbox).toBeDisabled();
  });

  test(`role catalogue groups read-only grants and localizes effective roles (${locale})`, async ({
    page,
  }) => {
    const fa = locale === 'fa';
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    const writes: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/admin/') && request.method() !== 'GET')
        writes.push(request.url());
    });
    await page.route('**/api/admin/roles', (route) =>
      route.fulfill({
        json: [
          ...roles,
          {
            roleId: 'role-finance',
            name: 'Finance',
            description: 'Money',
            permissions: ['payments:write', 'invoices:read'],
            predefined: true,
          },
          {
            roleId: 'role-admin',
            name: 'Admin',
            description: 'Everything',
            permissions: ['*'],
            predefined: true,
          },
        ],
      })
    );
    await page.route('**/api/admin/users/requested/effective-permissions', (route) =>
      route.fulfill({ json: result('requested') })
    );
    await page.goto('/admin/roles');
    await page.evaluate((lang) => {
      document.documentElement.lang = lang;
    }, locale);
    const content = page.locator('#admin-content');
    const finance = page
      .getByRole('row')
      .filter({ has: page.getByRole('rowheader', { name: fa ? /^مالی/ : /^Finance/ }) });
    await expect(
      finance.getByRole('group', { name: fa ? 'پرداخت‌ها' : 'Payments', exact: true })
    ).toBeVisible();
    const checkboxes = content.getByRole('checkbox');
    await expect(checkboxes).toHaveCount(4);
    for (const checkbox of await checkboxes.all()) {
      await expect(checkbox).toBeChecked();
      await expect(checkbox).toBeDisabled();
    }
    await expect(
      content.getByRole('checkbox', { name: fa ? 'همه دسترسی‌ها' : 'All permissions', exact: true })
    ).toBeChecked();
    await page.locator('#staffUserId').fill('requested');
    await page.locator('button[type=submit]').click();
    await expect(content).toContainText(
      fa ? 'نقش‌ها: پشتیبانی مشتریان' : 'Roles: Customer Support'
    );
    for (const dark of [false, true]) {
      await page.evaluate(async (value) => {
        document.documentElement.classList.toggle('dark', value);
        await Promise.all(
          document
            .getAnimations()
            .filter((a) => a.effect?.getComputedTiming().endTime !== Infinity)
            .map((a) => a.finished.catch(() => {}))
        );
      }, dark);
      const report = await new AxeBuilder({ page }).include('#admin-content').analyze();
      expect(report.violations, `role catalogue accessibility, dark=${dark}`).toEqual([]);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
    ).toBe(true);
    expect(writes).toEqual([]);
  });

  test(`permission lookup rejects another user and recovers (${locale})`, async ({ page }) => {
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/admin/roles', (route) => route.fulfill({ json: roles }));
    let valid = false;
    await page.route('**/api/admin/users/requested/effective-permissions', (route) =>
      route.fulfill({ json: result(valid ? 'requested' : 'other-user') })
    );
    await page.goto('/admin/roles');
    await page.evaluate((lang) => {
      document.documentElement.lang = lang;
    }, locale);
    await page.locator('#staffUserId').fill('requested');
    await page.locator('button[type=submit]').click();
    await expect(page.getByRole('alert')).toContainText(
      locale === 'fa' ? 'خطا در دریافت دسترسی‌های کاربر' : 'Failed to look up user permissions'
    );
    await expect(page.getByText('other-user', { exact: true })).toHaveCount(0);
    valid = true;
    await page.locator('button[type=submit]').click();
    await expect(page.getByText('requested', { exact: true })).toBeVisible();
    await page.locator('#staffUserId').fill('next-user');
    await expect(page.getByText('requested', { exact: true })).toHaveCount(0);
  });
}

test('editing a lookup cancels its pending permissions result', async ({ page }) => {
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/admin/roles', (route) => route.fulfill({ json: roles }));
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const requested = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route('**/api/admin/users/first/effective-permissions', async (route) => {
    started();
    await pending;
    await route.fulfill({ json: result('first') });
  });
  await page.route('**/api/admin/users/second/effective-permissions', (route) =>
    route.fulfill({ json: result('second') })
  );
  await page.goto('/admin/roles');
  await page.locator('#staffUserId').fill('first');
  await page.locator('button[type=submit]').click();
  await requested;
  try {
    await page.locator('#staffUserId').fill('second');
    await expect(page.locator('button[type=submit]')).toBeEnabled();
    await page.locator('button[type=submit]').click();
    await expect(page.getByText('second', { exact: true })).toBeVisible();
  } finally {
    release();
  }
  await expect(page.getByText('first', { exact: true })).toHaveCount(0);
});
