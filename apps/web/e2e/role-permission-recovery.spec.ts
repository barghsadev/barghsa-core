import { test, expect } from './coverage-fixture';
import AxeBuilder from '@axe-core/playwright';
import { crmShell } from './crm-shell-fixture';
import { t } from '@barghsa/i18n/admin-ui';

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
    await crmShell(page, locale);
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
    await page.locator(`main a[href="/admin/roles/${roles[0]!.roleId}"]:visible`).click();
    await expect(page).toHaveURL(new RegExp(`/admin/roles/${roles[0]!.roleId}$`));
    await page.reload();
    const checkbox = page.getByRole('checkbox', { name: 'tickets:read', exact: true });
    await expect(checkbox).toBeVisible();
    await expect(checkbox).toBeChecked();
    await expect(checkbox).toBeDisabled();
  });

  test(`role catalogue groups read-only grants and localizes effective roles (${locale})`, async ({
    page,
  }) => {
    const fa = locale === 'fa';
    await crmShell(page, locale);
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
    await page.goto('/admin/roles/compare');
    await page.evaluate((lang) => {
      document.documentElement.lang = lang;
    }, locale);
    const content = page.locator('main[data-area=admin]');
    const finance = page
      .getByRole('row')
      .filter({ has: page.getByRole('rowheader', { name: fa ? /^مالی/ : /^Finance/ }) })
      .or(
        content.getByRole('listitem').filter({
          has: page.getByRole('heading', { name: fa ? 'مالی' : 'Finance', exact: true }),
        })
      );
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
    await page.goto('/admin/roles/effective');
    await page.locator('[data-permission-id-toggle]').click();
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
      const report = await new AxeBuilder({ page }).include('main[data-area=admin]').analyze();
      expect(report.violations, `role catalogue accessibility, dark=${dark}`).toEqual([]);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
    ).toBe(true);
    expect(writes).toEqual([]);
  });

  test(`permission lookup rejects another user and recovers (${locale})`, async ({ page }) => {
    await crmShell(page, locale);
    await page.route('**/api/admin/roles', (route) => route.fulfill({ json: roles }));
    let valid = false;
    await page.route('**/api/admin/users/requested/effective-permissions', (route) =>
      route.fulfill({ json: result(valid ? 'requested' : 'other-user') })
    );
    await page.goto('/admin/roles/effective');
    await page.locator('[data-permission-id-toggle]').click();
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
  await crmShell(page, 'en');
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
  await page.goto('/admin/roles/effective');
  await page.locator('[data-permission-id-toggle]').click();
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

for (const locale of ['en', 'fa'] as const) {
  test(`chooses a named staff account and recovers its permission lookup (${locale})`, async ({
    page,
  }) => {
    await crmShell(page, locale);
    const label = (key: string) => t(`admin.roles.${key}`, locale);
    const name = locale === 'fa' ? 'سارا احمدی' : 'Sara Ahmadi';
    let permissionReads = 0;
    const searches: string[] = [];
    await page.route('**/api/admin/staff/search?*', (route) => {
      searches.push(new URL(route.request().url()).searchParams.get('q')!);
      return route.fulfill({
        json: {
          items: [{ userId: 'selected', username: 'sara@example.test', name }],
          hasMore: false,
        },
      });
    });
    await page.route('**/api/admin/users/selected/effective-permissions', (route) => {
      permissionReads++;
      return permissionReads === 1
        ? route.fulfill({ status: 503, json: {} })
        : route.fulfill({ json: result('selected') });
    });
    await page.goto('/admin/roles/effective');
    const field = page.getByRole('searchbox', { name: label('lookup.searchLabel'), exact: true });
    await expect(page.locator('#staffUserId')).toBeHidden();
    await expect(field).toBeVisible();
    expect(searches).toEqual([]);
    await field.fill(name.slice(0, 4));
    const match = page.getByRole('button', { name: new RegExp(name) });
    await expect(match).toContainText('sara@example.test');
    expect(searches).toEqual([name.slice(0, 4)]);
    expect(permissionReads).toBe(0);
    await match.focus();
    await page.keyboard.press('Enter');
    const heading = page.getByRole('heading', { name, exact: true });
    await expect(heading).toBeVisible();
    await expect(
      page.getByRole('alert').filter({ hasText: label('user.lookup.failed') })
    ).toBeVisible();
    await page.getByRole('button', { name: label('retry'), exact: true }).click();
    await expect(heading).toBeFocused();
    await expect(page.getByTestId('effective-permissions')).toContainText('tickets:read');
    expect(permissionReads).toBe(2);
  });
}

test('staff search denial leaves the authorized exact-ID form available', async ({ page }) => {
  await crmShell(page, 'en');
  await page.route('**/api/admin/staff/search?*', (route) =>
    route.fulfill({ status: 403, json: {} })
  );
  await page.route('**/api/admin/users/known/effective-permissions', (route) =>
    route.fulfill({ json: result('known') })
  );
  await page.goto('/admin/roles/effective');
  await page.getByRole('searchbox', { name: 'Find a staff account' }).fill('staff');
  await expect(
    page.getByText(t('admin.roles.lookup.searchDenied', 'en'), { exact: true })
  ).toBeVisible();
  await page.locator('[data-permission-id-toggle]').click();
  await page.getByLabel('User ID', { exact: true }).fill('known');
  await page.getByRole('button', { name: 'View permissions', exact: true }).click();
  await expect(page.getByTestId('effective-permissions')).toContainText('known');
});
