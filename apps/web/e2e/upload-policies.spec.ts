import { test, expect } from './coverage-fixture';
import { ErrorCodes } from '@barghsa/shared/errors';
for (const locale of ['en', 'fa'])
  test(`upload policy editor retains an exact save across failures (${locale})`, async ({
    page,
  }) => {
    const fa = locale === 'fa';
    await page.addInitScript((value) => {
      new MutationObserver(() => {
        if (document.documentElement) document.documentElement.lang = value;
      }).observe(document, { childList: true });
    }, locale);
    let canEdit = true,
      failLoad = true,
      verified = false,
      failSave = true;
    const attempts: unknown[] = [];
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/user/settings/timezone', (route) =>
      route.fulfill({ json: { timezone: 'America/Los_Angeles' } })
    );
    await page.route('**/api/admin/upload-policies/access', (route) =>
      route.fulfill({ json: { canEdit } })
    );
    await page.route('**/api/admin/upload-policies/limits', (route) =>
      route.fulfill({
        json: [
          {
            category: 'document',
            allowedExtensions: ['.pdf', '.docx'],
            maxSizeBytes: 10 * 1024 * 1024,
          },
        ],
      })
    );
    await page.route('**/api/admin/upload-policies', (route) => {
      if (route.request().method() === 'GET')
        return route.fulfill(failLoad ? { status: 503, json: {} } : { json: [] });
      attempts.push(route.request().postDataJSON());
      if (!verified)
        return route.fulfill({
          status: 403,
          json: { error: { code: ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code } },
        });
      if (failSave) return route.fulfill({ status: 503, json: {} });
      canEdit = false;
      return route.fulfill({ status: 201, json: { id: 'test-policy' } });
    });
    await page.route('**/api/auth/step-up', (route) => {
      verified = route.request().postDataJSON().password === 'correct-password';
      return route.fulfill({ status: verified ? 200 : 401, json: {} });
    });
    await page.goto('/admin/upload-policies');
    await expect(page.getByRole('alert')).toBeVisible();
    failLoad = false;
    await page.getByRole('button', { name: fa ? 'تلاش مجدد' : 'Try again', exact: true }).click();
    await page
      .getByRole('button', { name: fa ? 'ویرایش اسناد' : 'Edit Documents', exact: true })
      .click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('.pdf', { exact: true }).uncheck();
    await dialog.getByLabel('.docx', { exact: true }).uncheck();
    await dialog
      .getByRole('button', { name: fa ? 'ذخیره سیاست' : 'Save policy', exact: true })
      .click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    expect(attempts).toHaveLength(0);
    await dialog.getByLabel('.pdf', { exact: true }).check();
    await dialog.locator('#upload-policy-size').fill('1');
    await dialog
      .getByRole('button', { name: fa ? 'ذخیره سیاست' : 'Save policy', exact: true })
      .click();
    dialog = page.getByRole('dialog');
    await expect(dialog).toHaveCount(1);
    const confirm = dialog.getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true });
    await confirm.click();
    const password = dialog.locator('input[type="password"]');
    await password.fill('wrong');
    await confirm.click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await password.fill('correct-password');
    await confirm.click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    failSave = false;
    await password.fill('correct-password');
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    expect(attempts).toHaveLength(3);
    for (const body of attempts)
      expect(body).toEqual({
        category: 'document',
        allowedExtensions: ['.pdf'],
        maxSizeBytes: 1048576,
      });
    await expect(page.getByRole('alert')).toContainText(
      fa ? 'اجازه مدیریت' : 'do not have permission'
    );
    await expect(page.locator('tbody tr')).toHaveCount(0);
  });
