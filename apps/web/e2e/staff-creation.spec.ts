import { test, expect } from './coverage-fixture';
import AxeBuilder from '@axe-core/playwright';

for (const locale of ['en', 'fa'] as const) {
  test(`staff creation retains its draft through step-up and uses rotated CSRF (${locale})`, async ({
    page,
    context,
    baseURL,
  }) => {
    const fa = locale === 'fa';
    await page.addInitScript((value) => {
      if (document.documentElement) document.documentElement.lang = value;
      new MutationObserver(() => {
        if (document.documentElement) document.documentElement.lang = value;
      }).observe(document, { childList: true });
    }, locale);
    await context.addCookies([{ name: 'barghsa_csrf', value: 'before-create', url: baseURL! }]);
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/user/settings/timezone', (route) =>
      route.fulfill({ json: { timezone: 'UTC' } })
    );
    await page.route('**/api/admin/staff-access', (route) =>
      route.fulfill({
        json: {
          userId: 'admin',
          canView: false,
          canCreate: true,
          canEditRoles: false,
          canDisable: false,
        },
      })
    );
    await page.route('**/api/admin/staff?*', (route) =>
      route.fulfill({ json: { items: [], total: 0 } })
    );
    await page.route('**/api/admin/staff-role-options', (route) =>
      route.fulfill({
        json: [
          { roleId: 'role-finance', name: 'Finance', description: 'Manage finances' },
          { roleId: 'role-operations', name: 'Operations', description: 'Manage operations' },
        ],
      })
    );
    let verified = false;
    const attempts: { body: unknown; csrf: string | undefined }[] = [];
    await page.route('**/api/admin/users/create-staff', (route) => {
      attempts.push({
        body: route.request().postDataJSON(),
        csrf: route.request().headers()['x-csrf-token'],
      });
      return route.fulfill(
        verified
          ? {
              status: 201,
              json: {
                userId: 'new-staff',
                username: 'new.staff@example.test',
                temporaryPassword: 'One-time-fixture-password!',
              },
            }
          : {
              status: 403,
              json: { error: { code: 'AUTHZ:STEP_UP_REQUIRED' }, requiresStepUp: true },
            }
      );
    });
    await page.route('**/api/auth/step-up', (route) => {
      verified = route.request().postDataJSON().password === 'correct-password';
      return route.fulfill({
        status: verified ? 200 : 401,
        ...(verified
          ? { headers: { 'Set-Cookie': 'barghsa_csrf=after-create; Path=/; SameSite=Strict' } }
          : {}),
        json: {},
      });
    });
    await page.goto('/admin/users');
    const createLabel = fa ? 'ایجاد حساب کارمند' : 'Create staff user';
    await page.getByRole('button', { name: createLabel, exact: true }).click();
    const form = page.locator('form');
    await form
      .getByLabel(fa ? 'ایمیل یا شماره موبایل' : 'Email or mobile number', { exact: true })
      .fill('New.Staff@Example.Test');
    await form.getByLabel(fa ? 'نام' : 'First name', { exact: true }).fill('New');
    await form.getByLabel(fa ? 'نام خانوادگی' : 'Last name', { exact: true }).fill('Staff');
    await form.locator('summary').focus();
    await page.keyboard.press('Enter');
    await form.getByRole('checkbox', { name: fa ? /مالی/ : /Finance/ }).check();
    await form.getByRole('checkbox', { name: fa ? /عملیات/ : /Operations/ }).check();
    await expect(form.getByRole('checkbox', { checked: true })).toHaveCount(2);
    for (const dark of [false, true]) {
      await page.evaluate(async (value) => {
        document.documentElement.classList.toggle('dark', value);
        await Promise.all(
          document
            .getAnimations()
            .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
            .map((animation) => animation.finished.catch(() => {}))
        );
      }, dark);
      const report = await new AxeBuilder({ page }).include('#admin-content > section').analyze();
      expect(report.violations, `staff creation accessibility, dark=${dark}`).toEqual([]);
    }
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
    await form.locator('summary').click();
    await expect(form.locator('summary')).toContainText(fa ? 'مالی' : 'Finance');
    await expect(form.locator('summary')).toContainText(fa ? 'عملیات' : 'Operations');
    await form
      .getByRole('radio', { name: fa ? 'رمز عبور موقت یک‌بارمصرف' : 'One-time temporary password' })
      .check();
    await form.getByRole('button', { name: createLabel, exact: true }).click();
    const dialog = page.getByRole('dialog');
    const confirm = dialog.getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true });
    expect(attempts).toHaveLength(0);
    await confirm.click();
    await expect(dialog.locator('#team-step-up-password')).toBeVisible();
    await dialog.locator('#team-step-up-password').fill('wrong-password');
    await confirm.click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    expect(attempts).toHaveLength(1);
    await dialog.locator('#team-step-up-password').fill('correct-password');
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    const expectedBody = {
      username: 'new.staff@example.test',
      firstName: 'New',
      lastName: 'Staff',
      roleIds: ['role-finance', 'role-operations'],
      activationMethod: 'tempPassword',
    };
    expect(attempts).toEqual([
      { body: expectedBody, csrf: 'before-create' },
      { body: expectedBody, csrf: 'after-create' },
    ]);
    await expect(
      page.getByLabel(fa ? 'رمز عبور موقت' : 'Temporary password', { exact: true })
    ).toHaveValue('One-time-fixture-password!');
    await page
      .getByRole('button', { name: fa ? 'بستن نتیجه' : 'Dismiss result', exact: true })
      .click();
    await expect(page.locator('#staff-created-password')).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('button', { name: createLabel, exact: true })).toBeVisible();
    await expect(page.locator('#staff-created-password')).toHaveCount(0);
  });
}
