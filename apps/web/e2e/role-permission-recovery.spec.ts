import { test, expect } from './coverage-fixture';

const roles = [
  {
    roleId: 'role-support',
    name: 'Support',
    description: 'Tickets only',
    permissions: ['tickets:view'],
    predefined: true,
  },
];
const result = (userId: string) => ({
  userId,
  isAdmin: false,
  roleIds: ['role-support'],
  roleNames: ['Support'],
  permissions: [{ permission: 'tickets:view', group: 'tickets' }],
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
    await expect(page.getByRole('cell', { name: 'tickets tickets:view' })).toBeVisible();
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
