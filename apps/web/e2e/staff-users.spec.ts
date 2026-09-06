import { test, expect } from '@playwright/test';

for (const locale of ['en', 'fa'] as const) {
  test(`staff permissions, confirmation and step-up failures remain recoverable (${locale})`, async ({
    page,
  }) => {
    await page.addInitScript((value) => {
      new MutationObserver(() => {
        if (document.documentElement) document.documentElement.lang = value;
      }).observe(document, { childList: true });
    }, locale);
    const fa = locale === 'fa';
    let allowed = true,
      failLoad = true,
      verified = false,
      failSave = true;
    const attempts: unknown[] = [];
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/admin/staff-access', (route) =>
      route.fulfill({
        json: {
          userId: 'admin',
          canView: allowed,
          canCreate: false,
          canEditRoles: allowed,
          canDisable: allowed,
        },
      })
    );
    await page.route('**/api/admin/roles', (route) =>
      route.fulfill({
        json: [{ roleId: 'role-finance', name: 'Finance', description: 'Manage finances' }],
      })
    );
    await page.route('**/api/admin/staff?*', (route) =>
      failLoad
        ? route.fulfill({ status: 503, json: {} })
        : route.fulfill({
            json: {
              items: [
                {
                  userId: 'target',
                  username: 'target@example.test',
                  firstName: 'Target',
                  lastName: 'Staff',
                  roles: [],
                  status: 'active',
                  isAdmin: false,
                  lastLoginAt: null,
                },
              ],
              total: 1,
            },
          })
    );
    await page.route('**/api/admin/users/target/roles', (route) => {
      attempts.push(route.request().postDataJSON());
      if (!verified)
        return route.fulfill({
          status: 403,
          json: { error: 'AUTHZ:STEP_UP:REQUIRED', requiresStepUp: true },
        });
      if (failSave) return route.fulfill({ status: 503, json: {} });
      allowed = false;
      return route.fulfill({ json: { roleIds: ['role-finance'] } });
    });
    await page.route('**/api/auth/step-up', (route) => {
      verified = route.request().postDataJSON().password === 'right-password';
      return route.fulfill({ status: verified ? 200 : 401, json: {} });
    });
    await page.goto('/admin/users');
    await expect(page.getByRole('alert')).toBeVisible();
    failLoad = false;
    await page.getByRole('button', { name: fa ? 'تلاش مجدد' : 'Retry', exact: true }).click();
    await expect(
      page.getByRole('button', {
        name: fa ? 'ایجاد حساب کارمند' : 'Create staff user',
        exact: true,
      })
    ).toHaveCount(0);
    await page
      .getByRole('button', { name: fa ? 'ویرایش نقش‌ها' : 'Edit roles', exact: true })
      .click();
    await page.getByRole('checkbox', { name: fa ? /مالی/ : /Finance/ }).check();
    await page.locator('#staff-role-reason').fill('New duties');
    await page
      .getByRole('button', { name: fa ? 'ذخیره نقش‌ها' : 'Save roles', exact: true })
      .click();
    const dialog = page.getByRole('dialog'),
      confirm = dialog.getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true });
    expect(attempts).toHaveLength(0);
    await confirm.click();
    await expect(page.locator('#team-step-up-password')).toBeVisible();
    await page.locator('#team-step-up-password').fill('wrong-password');
    await confirm.click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    expect(attempts).toHaveLength(1);
    await page.locator('#team-step-up-password').fill('right-password');
    await confirm.click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(page.locator('#team-step-up-password')).toHaveValue('');
    failSave = false;
    await page.locator('#team-step-up-password').fill('right-password');
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    expect(attempts).toEqual(Array(3).fill({ roleIds: ['role-finance'], reason: 'New duties' }));
    await expect(page.getByRole('table')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: fa ? 'ویرایش نقش‌ها' : 'Edit roles', exact: true })
    ).toHaveCount(0);
  });
}
