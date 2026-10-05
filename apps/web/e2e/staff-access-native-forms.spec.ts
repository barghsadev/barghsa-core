import { test, expect } from './coverage-fixture';
import AxeBuilder from '@axe-core/playwright';
import { t } from '@barghsa/i18n/admin-ui';
import { staffAccess, staffUser, staffRoles } from '../src/test/staff-directory-fixtures';

for (const locale of ['en', 'fa'] as const) {
  test(`staff forms keep drafts, link errors and focus after validation (${locale})`, async ({
    page,
  }, testInfo) => {
    const label = (key: string) => t(`admin.staff.${key}`, locale);
    await page.addInitScript((value) => localStorage.setItem('barghsa.locale', value), locale);
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/auth/user', (route) =>
      route.fulfill({
        json: {
          userId: 'admin',
          isStaff: true,
          operatingContext: 'staff',
          canSwitchContext: false,
          requiresTosAcceptance: false,
        },
      })
    );
    await page.route('**/api/user/settings/locale', (route) => route.fulfill({ json: { locale } }));
    await page.route('**/api/user/settings/timezone', (route) =>
      route.fulfill({ json: { timezone: 'UTC' } })
    );
    await page.route('**/api/admin/staff-access', (route) => route.fulfill({ json: staffAccess }));
    await page.route('**/api/admin/staff?*', (route) =>
      route.fulfill({ json: { items: [staffUser], total: 1 } })
    );
    await page.route('**/api/admin/staff-role-options', (route) =>
      route.fulfill({ json: staffRoles })
    );
    let writes = 0;
    await page.route('**/api/admin/users/create-staff', (route) => {
      writes++;
      return route.fulfill({
        status: 400,
        json: { error: { code: 'VALIDATION:INPUT:INVALID', fields: ['firstName'] } },
      });
    });
    await page.goto('/admin/users');
    await page.getByRole('button', { name: label('create'), exact: true }).click();
    const form = page.locator('form');
    await form.locator('#staff-lastName').fill('  Retained surname  ');
    await form.getByRole('button', { name: label('create'), exact: true }).click();
    const username = form.locator('#staff-username');
    await expect(username).toBeFocused();
    await expect(username).toHaveAttribute('aria-invalid', 'true');
    await expect(
      page.locator(`[id="${await username.getAttribute('aria-describedby')}"]`)
    ).toHaveText(label('invalidUsername'));
    await expect(form.locator('#staff-lastName')).toHaveValue('  Retained surname  ');
    expect(writes).toBe(0);
    await form.screenshot({ path: testInfo.outputPath('staff-create-validation.png') });
    await username.fill('  Staff@Example.Test  ');
    await form.locator('#staff-firstName').fill('  First name  ');
    await form.getByRole('button', { name: label('create'), exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: locale === 'fa' ? 'تأیید' : 'Confirm', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(form.locator('#staff-firstName')).toBeFocused();
    await expect(form.locator('#staff-firstName')).toHaveAttribute('aria-invalid', 'true');
    await expect(username).toHaveValue('  Staff@Example.Test  ');
    await expect(form.locator('#staff-lastName')).toHaveValue('  Retained surname  ');
    expect(writes).toBe(1);
    await form.getByRole('button', { name: label('cancel'), exact: true }).click();
    await page.getByRole('button', { name: label('editRoles'), exact: true }).click();
    await form.getByRole('button', { name: label('saveRoles'), exact: true }).click();
    await expect(form.locator('#staff-role-reason')).toBeFocused();
    await expect(form.locator('#staff-role-reason')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await form.screenshot({ path: testInfo.outputPath('staff-role-validation.png') });
    const report = await new AxeBuilder({ page }).include('form').analyze();
    expect(report.violations).toEqual([]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
  });

  test(`effective permission lookup validates a blank ID without a read (${locale})`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((value) => localStorage.setItem('barghsa.locale', value), locale);
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/auth/user', (route) =>
      route.fulfill({
        json: {
          userId: 'admin',
          isStaff: true,
          operatingContext: 'staff',
          canSwitchContext: false,
          requiresTosAcceptance: false,
        },
      })
    );
    await page.route('**/api/user/settings/locale', (route) => route.fulfill({ json: { locale } }));
    await page.route('**/api/admin/roles', (route) =>
      route.fulfill({
        json: staffRoles.map((role) => ({
          ...role,
          permissions: ['finance:view'],
          predefined: true,
        })),
      })
    );
    let reads = 0;
    await page.route('**/api/admin/users/*/effective-permissions', (route) => {
      reads++;
      return route.fulfill({ status: 404, json: {} });
    });
    await page.goto('/admin/roles');
    const input = page.locator('#staffUserId');
    await expect(input).toBeVisible();
    await input.fill('   ');
    await page
      .getByRole('button', { name: t('admin.roles.effective.lookup', locale), exact: true })
      .click();
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator(`[id="${await input.getAttribute('aria-describedby')}"]`)).toHaveText(
      t('admin.roles.effective.invalidUserId', locale)
    );
    expect(reads).toBe(0);
    const feedback = page.locator(`[id="${await input.getAttribute('aria-describedby')}"]`);
    expect(await feedback.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true
    );
    await page
      .locator('form')
      .screenshot({ path: testInfo.outputPath('staff-permission-validation.png') });
    const report = await new AxeBuilder({ page }).include('form').analyze();
    expect(report.violations).toEqual([]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
  });
}
