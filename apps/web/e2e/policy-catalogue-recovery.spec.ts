import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from './coverage-fixture';
import { t } from '@barghsa/i18n/admin-ui';
import { t as appT } from '@barghsa/i18n/app';
import {
  catalogueRole,
  effectivePermissions,
  policyLimit,
  uploadPolicy,
} from '../src/test/policy-catalogue-fixtures';
test.use({ viewport: { width: 390, height: 844 } });
async function shell(page: Page, locale: 'en' | 'fa') {
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
  await page.route('**/api/user/settings/timezone', (route) =>
    route.fulfill({ json: { timezone: 'Asia/Tehran' } })
  );
}
async function inspect(
  page: Page,
  title: string,
  locale: 'en' | 'fa',
  project: string,
  name: string
) {
  const viewport = page
    .getByRole('region', { name: title, exact: true })
    .locator('[data-slot="scroll-area-viewport"]');
  await viewport.focus();
  await viewport.press(locale === 'fa' ? 'ArrowLeft' : 'ArrowRight');
  await expect
    .poll(() => viewport.evaluate((node) => Math.abs(node.scrollLeft)))
    .toBeGreaterThan(0);
  expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (locale === 'fa' && project === 'mobile-safari')
    await page.screenshot({
      path: `/tmp/barghsa-policy-catalogue-${name}-fa-mobile-safari.png`,
      fullPage: true,
    });
}
for (const locale of ['en', 'fa'] as const) {
  const r = (key: string) => t(`admin.roles.${key}`, locale),
    u = (key: string) => t(`admin.uploadPolicies.${key}`, locale);
  const refresh = t('admin.jobs.refresh', locale),
    retry = t('admin.jobs.reload', locale);
  test(`role list recovery keeps independent lookup work and denial clears private data (${locale})`, async ({
    page,
  }, info) => {
    await shell(page, locale);
    let fail = false,
      deny = false,
      lookups = 0;
    await page.route('**/api/admin/roles', (route) =>
      route.fulfill(
        deny
          ? { status: 403, json: {} }
          : fail
            ? { status: 503, json: {} }
            : { json: [catalogueRole] }
      )
    );
    await page.route('**/api/admin/users/*/effective-permissions', (route) => {
      lookups++;
      return route.fulfill({ json: effectivePermissions });
    });
    await page.goto('/admin/roles');
    await expect(page.locator('tbody')).toContainText('finance:read');
    await page.locator('#staffUserId').fill('staff-one');
    await page.getByRole('button', { name: r('effective.lookup'), exact: true }).click();
    await expect(page.locator('main')).toContainText('staff-one');
    await inspect(page, r('title'), locale, info.project.name, 'roles');
    fail = true;
    await page.getByRole('button', { name: refresh, exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(r('load.failed'));
    await expect(page.locator('tbody')).toContainText('finance:read');
    await expect(page.locator('#staffUserId')).toHaveValue('staff-one');
    await expect(
      page.getByRole('button', { name: r('effective.lookup'), exact: true })
    ).toBeDisabled();
    await page.locator('#staffUserId').fill('staff-two');
    fail = false;
    await page.getByRole('button', { name: r('retry'), exact: true }).click();
    await expect(page.locator('#staffUserId')).toHaveValue('staff-two');
    expect(lookups).toBe(1);
    deny = true;
    await page.getByRole('button', { name: refresh, exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText(r('forbidden'));
    await expect(page.locator('table')).toHaveCount(0);
    await expect(page.locator('#staffUserId')).toHaveCount(0);
    deny = false;
    await page.getByRole('button', { name: refresh, exact: true }).click();
    await expect(page.locator('#staffUserId')).toHaveValue('');
  });
  test(`upload policy editor and confirmation recover in place and discard changed or denied work (${locale})`, async ({
    page,
  }, info) => {
    await shell(page, locale);
    let fail = false,
      deny = false,
      ceiling = policyLimit.maxSizeBytes,
      accesses = 0;
    await page.route('**/api/admin/upload-policies/access', (route) => {
      accesses++;
      return route.fulfill({ json: { canEdit: !deny } });
    });
    await page.route('**/api/admin/upload-policies/limits', (route) =>
      route.fulfill({ json: [{ ...policyLimit, maxSizeBytes: ceiling }] })
    );
    await page.route('**/api/admin/upload-policies', (route) =>
      route.fulfill(fail ? { status: 503, json: {} } : { json: [uploadPolicy] })
    );
    await page.goto('/admin/upload-policies');
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await inspect(page, u('title'), locale, info.project.name, 'uploads');
    await page
      .getByRole('button', { name: `${u('edit')} ${u('category.document')}`, exact: true })
      .click();
    let dialog = page.getByRole('dialog');
    await dialog.locator('#upload-policy-size').fill('1.5');
    fail = true;
    await dialog.getByRole('button', { name: refresh, exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText(u('loadError'));
    await expect(dialog.locator('#upload-policy-size')).toHaveValue('1.5');
    await expect(dialog.getByRole('button', { name: u('save'), exact: true })).toBeDisabled();
    await dialog.locator('#upload-policy-size').fill('1');
    fail = false;
    const reads = accesses;
    await dialog.getByRole('button', { name: retry, exact: true }).click();
    await expect(dialog.getByRole('button', { name: u('save'), exact: true })).toBeEnabled();
    expect(accesses).toBe(reads);
    await expect(dialog.locator('#upload-policy-size')).toHaveValue('1');
    expect(
      (await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations
    ).toEqual([]);
    if (locale === 'fa' && info.project.name === 'mobile-safari')
      await page.screenshot({
        path: '/tmp/barghsa-policy-catalogue-editor-fa-mobile-safari.png',
        fullPage: true,
      });
    ceiling = 1048576;
    await dialog.getByRole('button', { name: refresh, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page
      .getByRole('button', { name: `${u('edit')} ${u('category.document')}`, exact: true })
      .click();
    dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: u('save'), exact: true }).click();
    const confirm = page
      .getByRole('dialog')
      .getByRole('button', { name: appT('team.confirm', locale), exact: true });
    fail = true;
    await page.getByRole('dialog').getByRole('button', { name: refresh, exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText(u('loadError'));
    await expect(confirm).toBeDisabled();
    fail = false;
    await page.getByRole('dialog').getByRole('button', { name: retry, exact: true }).click();
    await expect(confirm).toBeEnabled();
    deny = true;
    await page.getByRole('dialog').getByRole('button', { name: refresh, exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('table')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveText(u('forbidden'));
  });
}
