import { test, expect } from './coverage-fixture';
import AxeBuilder from '@axe-core/playwright';
import { t } from '@barghsa/i18n/admin-ui';
import { staffAccess, staffUser, staffRoles } from '../src/test/staff-directory-fixtures';

for (const locale of ['en', 'fa'] as const) {
  test(`staff forms keep drafts, link errors and focus after validation (${locale})`, async ({
    page,
  }, testInfo) => {
    const label = (key: string) => t(`admin.staff.${key}`, locale);
    const operations = {
      roleId: 'role-test-operations',
      name: 'Operations',
      description: 'Review orders',
    };
    const support = { roleId: 'role-test-support', name: 'Support', description: 'Review tickets' };
    const account = { ...staffUser, roles: [...staffRoles, support] };
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
      route.fulfill({ json: [...staffRoles, operations, support] })
    );
    let writes = 0;
    await page.route('**/api/admin/users/create-staff', (route) => {
      writes++;
      return route.fulfill({
        status: 400,
        json: { error: { code: 'VALIDATION:INPUT:INVALID', fields: ['firstName'] } },
      });
    });
    await page.route(`**/api/admin/staff/accounts/${staffUser.userId}`, (route) =>
      route.fulfill({ json: account })
    );
    await page.goto('/admin/users');
    await page.getByRole('link', { name: label('create'), exact: true }).click();
    const form = page.locator('form');
    await form.locator('#staff-lastName').fill('  Retained surname  ');
    await form.getByRole('button', { name: label('create'), exact: true }).click();
    const username = form.locator('#staff-username');
    for (const id of ['staff-username', 'staff-firstName', 'staff-lastName']) {
      await expect(form.locator(`#${id}`)).toHaveAttribute('aria-required', 'true');
    }
    await expect(form.getByRole('radiogroup')).toHaveAttribute('aria-required', 'true');
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
    await form.getByRole('link', { name: label('cancel'), exact: true }).click();
    await page.locator(`main a[href="/admin/users/${staffUser.userId}"]:visible`).click();
    await page.getByRole('link', { name: label('editRoles'), exact: true }).click();
    await form.getByRole('button', { name: label('saveRoles'), exact: true }).click();
    await expect(form.locator('#staff-role-reason')).toBeFocused();
    await expect(form.locator('#staff-role-reason')).toHaveAttribute('aria-required', 'true');
    await expect(form.locator('#staff-role-reason')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await form.screenshot({ path: testInfo.outputPath('staff-role-validation.png') });
    const report = await new AxeBuilder({ page }).include('form').analyze();
    expect(report.violations).toEqual([]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
    const selected = form.getByRole('list', { name: label('selectedRoles'), exact: true });
    await selected
      .getByRole('button', { name: locale === 'fa' ? /مالی|Finance/ : /Finance/ })
      .click();
    await expect(form.locator('summary')).toBeFocused();
    await expect(selected).not.toContainText(/مالی|Finance/);
    await form.getByText(label('chooseRoles'), { exact: true }).click();
    await form.getByRole('checkbox', { name: /Operations/ }).check();
    const reason =
      locale === 'fa'
        ? 'مسئولیت بررسی سفارش‌ها به این کارمند واگذار شد.'
        : 'Assigned to order review.';
    await form.locator('#staff-role-reason').fill(reason);
    await form.getByRole('button', { name: label('saveRoles'), exact: true }).click();
    const review = page.getByRole('dialog');
    for (const [key, expected] of [
      ['rolesAdded', /Operations/],
      ['rolesRemoved', /مالی|Finance/],
      ['rolesRetained', /Support/],
      ['reason', reason],
    ] as const)
      await expect(
        review.locator('dl > div').filter({
          has: page.getByText(label(key), { exact: true }),
        })
      ).toContainText(expected);
    await review.getByRole('button', { name: label('cancel'), exact: true }).click();
    await expect(selected).toContainText('Operations');
    await expect(selected).toContainText('Support');
    await expect(form.locator('#staff-role-reason')).toHaveValue(reason);
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
    await page.goto('/admin/roles/effective');
    await page.locator('[data-permission-id-toggle]').click();
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
