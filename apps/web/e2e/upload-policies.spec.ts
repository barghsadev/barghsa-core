import { mockOppositeNumerals } from './number-preference-fixture';
import { test, expect } from './coverage-fixture';
import { setupCatalogueForms } from './catalogue-form-fixture';
import { uploadPolicy } from '../src/test/policy-catalogue-fixtures';
import { ErrorCodes } from '@barghsa/shared/errors';
import { t } from '@barghsa/i18n/admin-ui';
for (const locale of ['en', 'fa'])
  test(`upload policy editor retains an exact save across failures (${locale})`, async ({
    page,
  }) => {
    const fa = locale === 'fa';
    await setupCatalogueForms(page, fa ? 'fa' : 'en', false);
    let canEdit = true,
      failLoad = true,
      verified = false,
      failSave = true;
    const attempts: unknown[] = [];
    await mockOppositeNumerals(page, locale);
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
            maxSizeBytes: 10.5 * 1024 * 1024,
          },
        ],
      })
    );
    await page.route('**/api/admin/upload-policies?category=document', (route) =>
      route.fulfill({ json: [] })
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
      if (failSave) return route.fulfill({ status: 400, json: {} });
      canEdit = false;
      return route.fulfill({
        status: 201,
        json: { ...uploadPolicy, ...route.request().postDataJSON() },
      });
    });
    await page.route('**/api/auth/step-up', (route) => {
      verified = route.request().postDataJSON().password === 'correct-password';
      return route.fulfill({ status: verified ? 200 : 401, json: {} });
    });
    const failedRead = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/admin/upload-policies' &&
        response.request().method() === 'GET' &&
        response.status() === 503
    );
    await page.goto('/admin/upload-policies');
    await failedRead;
    await expect(page.getByRole('alert')).toBeVisible();
    failLoad = false;
    await page.getByRole('button', { name: fa ? 'تلاش مجدد' : 'Try again', exact: true }).click();
    await expect(page.locator('main')).toContainText(fa ? '10.5' : '۱۰٫۵');
    await page
      .getByRole('link', {
        name: fa ? 'ایجاد سیاست اسناد' : 'Create policy Documents',
        exact: true,
      })
      .click();
    await expect(page).toHaveURL('/admin/upload-policies/document/new');
    const form = page.getByRole('form');
    await form.getByLabel('.pdf', { exact: true }).uncheck();
    await form.getByLabel('.docx', { exact: true }).uncheck();
    await form
      .getByRole('button', { name: fa ? 'ذخیره سیاست' : 'Save policy', exact: true })
      .click();
    await expect(form.getByRole('alert').first()).toBeVisible();
    expect(attempts).toHaveLength(0);
    await form.getByLabel('.pdf', { exact: true }).check();
    await form.locator('#upload-policy-size').fill('1');
    await form
      .getByRole('button', { name: fa ? 'ذخیره سیاست' : 'Save policy', exact: true })
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toHaveCount(1);
    const label = (key: string) => t(`admin.uploadPolicies.${key}`, locale);
    const comparison = dialog.getByRole('region', { name: label('comparison'), exact: true });
    const current = comparison
      .getByRole('heading', { name: label('currentEffective') })
      .locator('..');
    const proposed = comparison.getByRole('heading', { name: label('nextVersion') }).locator('..');
    await expect(current).toContainText('.docx');
    await expect(current).toContainText(`${fa ? '10.5' : '۱۰٫۵'} ${label('mib')}`);
    await expect(proposed.getByText('.pdf', { exact: true })).toBeVisible();
    await expect(proposed).toContainText(`${fa ? '1' : '۱'} ${label('mib')}`);
    expect(attempts).toHaveLength(0);
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
    await expect(password).toHaveCount(0);
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(`/admin/upload-policies/document/versions/${uploadPolicy.id}`);
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
