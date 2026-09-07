import { test, expect } from './coverage-fixture';
for (const locale of ['en', 'fa'])
  test(`Policy form retries captured input after password verification (${locale})`, async ({
    page,
  }) => {
    const fa = locale === 'fa';
    await page.addInitScript((value) => {
      new MutationObserver(() => {
        if (document.documentElement) document.documentElement.lang = value;
      }).observe(document, { childList: true });
    }, locale);
    let failed = true,
      verified = false,
      denied = false;
    const attempts: unknown[] = [];
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/admin/policies', (route) => {
      if (route.request().method() === 'GET')
        return route.fulfill(
          denied ? { status: 403, json: {} } : failed ? { status: 503, json: {} } : { json: [] }
        );
      attempts.push(route.request().postDataJSON());
      if (!verified)
        return route.fulfill({ status: 403, json: { error: 'AUTHZ:STEP_UP_REQUIRED' } });
      denied = true;
      return route.fulfill({ status: 201, json: {} });
    });
    await page.route('**/api/auth/step-up', (route) => {
      verified = route.request().postDataJSON().password === 'correct';
      return route.fulfill({ status: verified ? 200 : 401, json: {} });
    });
    await page.goto('/admin/policies');
    await expect(page.getByRole('alert')).toBeVisible();
    failed = false;
    await page.getByRole('button', { name: fa ? 'تازه‌سازی' : 'Refresh', exact: true }).click();
    await page
      .getByRole('button', { name: fa ? 'افزودن سیاست' : 'Add policy', exact: true })
      .click();
    await page.getByLabel(fa ? 'عنوان' : 'Title', { exact: true }).fill('Local draft');
    await page
      .getByLabel(fa ? 'نوع سیاست' : 'Policy type', { exact: true })
      .selectOption(fa ? 'data_access_scope' : 'disallowed_actions');
    await page
      .getByLabel(fa ? 'محدوده دسترسی به داده' : 'Disallowed actions', { exact: true })
      .fill('Meter readings\nBilling');
    await page.getByRole('button', { name: fa ? 'ذخیره' : 'Save', exact: true }).click();
    const dialog = page.getByRole('dialog'),
      confirm = dialog.getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true });
    await confirm.click();
    await dialog.locator('input[type="password"]').fill('wrong');
    await confirm.click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await dialog.locator('input[type="password"]').fill('correct');
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    expect(attempts).toEqual(
      Array(2).fill({
        title: 'Local draft',
        description: '',
        policyType: fa ? 'data_access_scope' : 'disallowed_actions',
        rules: fa
          ? { scopes: ['Meter readings', 'Billing'] }
          : { actions: ['Meter readings', 'Billing'] },
        enabled: true,
      })
    );
    await expect(page.getByRole('alert')).toContainText(
      fa ? 'اجازه مدیریت' : 'permission to manage'
    );
    await expect(page.locator('input')).toHaveCount(0);
  });
