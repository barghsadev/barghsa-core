import { test, expect } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import {
  contractTemplate,
  contractTemplateDetail,
  templateVersion,
} from '../src/test/contract-settings-fixtures';
import { contractTemplatesText } from '@barghsa/i18n/contract-templates';
import { t } from '@barghsa/i18n/admin-ui';

for (const locale of ['en', 'fa'] as const) {
  test(`contract template selection survives reload and browser history (${locale})`, async ({
    page,
  }) => {
    await crmShell(page, locale);
    const list = '/admin/contract-templates';
    const label = (key: string) => contractTemplatesText(`admin.templates.${key}`, locale);
    const detailReads: string[] = [];
    let listReads = 0;
    const route = list + '/' + contractTemplate.id;
    await page.route('**/api/admin/contract-templates', (request) => {
      listReads++;
      return request.fulfill({ json: [contractTemplate] });
    });
    await page.route(`**/api${route}`, (request) => {
      expect(request.request().method()).toBe('GET');
      detailReads.push(new URL(request.request().url()).pathname);
      return request.fulfill({
        json: {
          ...contractTemplateDetail,
          versionCount: 1,
          latestVersion: templateVersion,
          versions: [templateVersion],
        },
      });
    });
    await page.route(`**/api${route}/versions/1/preview`, (request) =>
      request.fulfill({
        json: {
          templateId: contractTemplate.id,
          templateName: contractTemplate.name,
          versionNumber: 1,
          fileName: templateVersion.fileName,
          createdAt: templateVersion.createdAt,
          placeholders: ['customer'],
          text: 'Contract for {{customer}}',
          truncated: false,
        },
      })
    );
    await page.goto(list + '?selected=invalid');
    const open = page
      .getByRole('main')
      .getByRole('link', { name: contractTemplate.name, exact: true });
    const name = page.getByRole('textbox', { name: label('name'), exact: true });
    await expect(open).toBeVisible();
    expect(detailReads).toEqual([]);
    await open.click();
    await expect(page).toHaveURL(route);
    const detail = page.getByRole('main');
    await expect(
      detail.getByRole('heading', { name: contractTemplate.name, exact: true })
    ).toBeVisible();
    await detail
      .getByRole('link', { name: new RegExp(label('version')) })
      .filter({ hasNotText: label('upload') })
      .click();
    await expect(page).toHaveURL(route + '/versions/1');
    await expect(detail.locator('pre')).toHaveText('Contract for {{customer}}');
    await page.reload();
    await expect(detail.locator('pre')).toHaveText('Contract for {{customer}}');
    expect(detailReads).toEqual(['/api' + route]);
    expect(listReads).toBe(1);
    await page.goBack();
    await expect(
      detail.getByRole('heading', { name: contractTemplate.name, exact: true })
    ).toBeVisible();
    await page.goto(list + '?selected=' + contractTemplate.id);
    await expect(page).toHaveURL(route + '/edit');
    await expect(name).toHaveValue(contractTemplate.name);
    const status = page.getByRole('combobox', { name: label('status'), exact: true });
    await expect(status).toHaveValue('active');
    await expect(status).toHaveAccessibleDescription(label('activeUse'));
    await status.selectOption('inactive');
    await expect(status).toHaveAccessibleDescription(label('inactiveUse'));
    await page.getByRole('button', { name: label('save'), exact: true }).click();
    const review = page.getByRole('dialog', { name: label('save'), exact: true });
    await expect(review.getByText(contractTemplate.name, { exact: true })).toBeVisible();
    await expect(review.getByText(label('inactive'), { exact: true })).toBeVisible();
    await expect(review.getByText(label('inactiveUse'), { exact: true })).toBeVisible();
    await review.getByRole('button', { name: t('team.cancel', locale), exact: true }).click();
    await expect(status).toHaveValue('inactive');
  });
}

for (const locale of ['en', 'fa'] as const)
  test(`template editor retries captured metadata (${locale})`, async ({ page }) => {
    const fa = locale === 'fa';
    const label = (key: string) => contractTemplatesText(`admin.templates.${key}`, locale);
    await crmShell(page, locale);
    let failed = true,
      verified = false,
      denied = false;
    const attempts: unknown[] = [];
    await page.route('**/api/user/settings/timezone', (route) =>
      route.fulfill({ json: { timezone: 'America/Los_Angeles' } })
    );
    await page.route('**/api/admin/contract-templates', (route) => {
      if (route.request().method() === 'GET')
        return route.fulfill(
          denied ? { status: 403, json: {} } : failed ? { status: 503, json: {} } : { json: [] }
        );
      attempts.push(route.request().postDataJSON());
      if (!verified)
        return route.fulfill({ status: 403, json: { error: 'AUTHZ:STEP_UP_REQUIRED' } });
      denied = true;
      return route.fulfill({
        status: 201,
        json: { ...contractTemplate, name: 'Local contract', description: '' },
      });
    });
    await page.route(`**/api/admin/contract-templates/${contractTemplate.id}`, (route) =>
      route.fulfill({ status: denied ? 403 : 200, json: contractTemplateDetail })
    );
    await page.route('**/api/auth/step-up', (route) => {
      verified = route.request().postDataJSON().password === 'correct';
      return route.fulfill({ status: verified ? 200 : 401, json: {} });
    });
    await page.goto('/admin/contract-templates');
    await expect(page.getByRole('alert')).toBeVisible();
    failed = false;
    await page.getByRole('button', { name: fa ? 'تازه‌سازی' : 'Refresh', exact: true }).click();
    await page
      .getByRole('link', { name: fa ? 'افزودن قالب' : 'Add template', exact: true })
      .click();
    const name = page.getByRole('textbox', { name: fa ? 'نام' : 'Name', exact: true });
    await expect(name).toHaveAttribute('aria-required', 'true');
    await expect(name).toHaveAttribute('placeholder', label('nameExample'));
    await expect(name).toHaveCSS('direction', fa ? 'rtl' : 'ltr');
    await expect(page.getByText(label('firstVersionAfterSave'), { exact: true })).toBeVisible();
    await name.fill('  Local contract  ');
    await page
      .getByRole('button', { name: fa ? 'ذخیره قالب' : 'Save template', exact: true })
      .click();
    const dialog = page.getByRole('dialog'),
      confirm = dialog.getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true });
    await expect(dialog.getByText('Local contract', { exact: true })).toBeVisible();
    expect(attempts).toEqual([]);
    await confirm.click();
    const password = dialog.locator('input[type="password"]');
    await expect(password).toHaveAccessibleName(/\S/);
    await expect(password).toHaveAttribute('aria-required', 'true');
    await password.fill('wrong');
    await confirm.click();
    const error = dialog.getByRole('alert');
    await expect(error).toBeVisible();
    await expect(password).toHaveAttribute('aria-invalid', 'true');
    await expect(password).toHaveAccessibleDescription(await error.innerText());
    await password.fill('correct');
    await expect(password).not.toHaveAttribute('aria-invalid', 'true');
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    expect(attempts).toEqual(Array(2).fill({ name: 'Local contract', description: '' }));
    await expect(page.getByRole('alert')).toContainText(
      fa ? 'اجازه مدیریت' : 'permission to manage'
    );
    await expect(page.locator('input,textarea')).toHaveCount(0);
  });
