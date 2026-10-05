import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import { t } from '@barghsa/i18n/admin-ui';
import { t as appText } from '@barghsa/i18n/app';
import { staffAccess, staffUser, staffRoles } from '../src/test/staff-directory-fixtures';
import { catalogueRole } from '../src/test/policy-catalogue-fixtures';

async function inspect(page: Page) {
  expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

for (const locale of ['en', 'fa'] as const) {
  test(`staff cards preserve metadata, protected actions and breakpoint drafts (${locale})`, async ({
    page,
  }, info) => {
    const label = (key: string) => t(`admin.staff.${key}`, locale);
    await crmShell(page, locale);
    await page.route('**/api/user/settings/locale', (route) => route.fulfill({ json: { locale } }));
    let denied = false;
    await page.route('**/api/admin/staff-access', (route) => route.fulfill({ json: staffAccess }));
    await page.route('**/api/admin/staff-role-options', (route) =>
      route.fulfill({ json: staffRoles })
    );
    await page.route('**/api/admin/staff?*', (route) =>
      route.fulfill(
        denied
          ? { status: 403, json: {} }
          : {
              json: {
                items: [
                  {
                    ...staffUser,
                    activationPending: true,
                    activationExpiresAt: '2026-10-06T12:30:00Z',
                    lastLoginAt: '2026-10-05T08:15:00Z',
                  },
                ],
                total: 1,
              },
            }
      )
    );
    let writes = 0;
    await page.route('**/api/admin/users/*/roles', (route) => {
      writes++;
      return route.fulfill({ status: 500, json: {} });
    });
    await page.goto('/admin/users');
    await page.setViewportSize({ width: 390, height: 844 });
    const cards = page.getByRole('list', { name: label('title'), exact: true });
    const card = cards.getByRole('listitem');
    await expect(page.getByRole('table')).toHaveCount(0);
    await expect(card).toContainText('Finance Alice');
    await expect(card).toContainText(staffUser.username);
    await expect(card).toContainText(label('activationPending'));
    await expect(
      card.getByRole('button', { name: label('resendActivation'), exact: true })
    ).toBeEnabled();
    await expect(card.locator('time')).toHaveAttribute('datetime', '2026-10-05T08:15:00.000Z');
    await expect(card.getByRole('button', { name: label('disable'), exact: true })).toBeEnabled();
    await expect(
      card.getByRole('button', { name: t('admin.roles.effective.inspect', locale), exact: true })
    ).toBeEnabled();
    await inspect(page);
    if (locale === 'fa' && info.project.name === 'mobile-safari')
      await card.screenshot({
        path: '/Users/majid/.local/state/barghsa-manual-batches/staff-directory-tables/staff-card-fa.png',
      });

    await card.getByRole('button', { name: label('editRoles'), exact: true }).click();
    await page.locator('#staff-role-reason').fill('  Retained duties  ');
    await page.setViewportSize({ width: 1100, height: 900 });
    const table = page.getByRole('table');
    await expect(table).toBeVisible();
    await expect(page.getByRole('list', { name: label('title'), exact: true })).toHaveCount(0);
    await expect(table.getByRole('rowheader')).toContainText('Finance Alice');
    await expect(page.locator('#staff-role-reason')).toHaveValue('  Retained duties  ');
    const viewport = page.getByRole('region', { name: label('table'), exact: true });
    await viewport.focus();
    await viewport.press(locale === 'fa' ? 'ArrowLeft' : 'ArrowRight');
    await expect
      .poll(() => viewport.evaluate((node) => Math.abs(node.scrollLeft)))
      .toBeGreaterThan(0);
    await inspect(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('#staff-role-reason')).toHaveValue('  Retained duties  ');
    await page
      .locator('form')
      .getByRole('button', { name: label('saveRoles'), exact: true })
      .click();
    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('heading', { name: label('editRoles'), exact: true })
    ).toBeVisible();
    await expect(dialog).toContainText('Retained duties');
    await dialog.getByRole('button', { name: appText('team.cancel', locale), exact: true }).click();
    expect(writes).toBe(0);
    await expect(page.locator('#staff-role-reason')).toHaveValue('  Retained duties  ');
    denied = true;
    await page.getByRole('button', { name: label('refresh'), exact: true }).click();
    await expect(cards).toHaveCount(0);
    await expect(page.locator('table')).toHaveCount(0);
    await expect(page.locator('#staff-role-reason')).toHaveCount(0);
  });

  test(`role cards preserve read-only comparisons and clear denied catalogue (${locale})`, async ({
    page,
  }, info) => {
    const label = (key: string) => t(`admin.roles.${key}`, locale);
    await crmShell(page, locale);
    await page.route('**/api/user/settings/locale', (route) => route.fulfill({ json: { locale } }));
    let denied = false;
    await page.route('**/api/admin/roles', (route) =>
      route.fulfill(
        denied
          ? { status: 403, json: {} }
          : {
              json: [
                {
                  ...catalogueRole,
                  name: '<Finance reviewer>',
                  description: '<script>literal</script>',
                },
                {
                  ...catalogueRole,
                  roleId: 'writer',
                  name: locale === 'fa' ? 'نویسنده مالی' : 'Finance writer',
                  description: locale === 'fa' ? 'ثبت و بررسی امور مالی' : 'Payment review',
                  permissions: ['finance:write'],
                },
                { ...catalogueRole, roleId: 'all', name: 'All access', permissions: ['*'] },
              ],
            }
      )
    );
    await page.goto('/admin/roles?module=finance');
    await page.setViewportSize({ width: 390, height: 844 });
    const cards = page.getByRole('list', { name: label('catalogue'), exact: true });
    const rows = cards
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading', { level: 2 }) });
    await expect(rows).toHaveCount(3);
    await expect(rows.first()).toContainText('<script>literal</script>');
    await expect(cards.locator('script')).toHaveCount(0);
    for (const [index, grants] of [
      [0, [true, false]],
      [1, [false, true]],
      [2, [true, true]],
    ] as const) {
      for (const [column, checked] of grants.entries()) {
        const checkbox = rows.nth(index).getByRole('checkbox').nth(column);
        await expect(checkbox).toBeDisabled();
        await expect(checkbox).toBeChecked({ checked });
      }
    }
    await inspect(page);
    if (locale === 'fa' && info.project.name === 'mobile-safari') {
      await rows.nth(1).scrollIntoViewIfNeeded();
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          )
      );
      await rows.nth(1).screenshot({
        path: '/Users/majid/.local/state/barghsa-manual-batches/staff-directory-tables/role-card-fa.png',
      });
    }
    const module = page.getByRole('combobox', { name: label('compare.module'), exact: true });
    await module.selectOption('invoices');
    await expect(rows.nth(1).getByRole('checkbox')).not.toBeChecked();
    await page.setViewportSize({ width: 1100, height: 900 });
    await expect(module).toHaveValue('invoices');
    await expect(page.getByRole('table').getByRole('rowheader')).toHaveCount(3);
    await expect(
      page.getByRole('table').locator('tbody tr').nth(1).getByRole('checkbox')
    ).not.toBeChecked();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(module).toHaveValue('invoices');
    await module.selectOption('');
    await expect(rows.first()).toContainText('invoices:read');
    denied = true;
    await page.getByRole('button', { name: t('admin.jobs.refresh', locale), exact: true }).click();
    await expect(cards).toHaveCount(0);
    await expect(page.locator('table')).toHaveCount(0);
    await expect(page.getByRole('alert')).toContainText(label('forbidden'));
  });
}
