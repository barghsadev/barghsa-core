import AxeBuilder from '@axe-core/playwright';
import type { Route } from '@playwright/test';
import { test, expect, type Page } from './coverage-fixture';
import { t } from '@barghsa/i18n/admin-ui';
import { t as appT } from '@barghsa/i18n/app';
import { storagePolicyFormText } from '@barghsa/i18n/storage-policy-forms';
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
  const originalViewport = page.viewportSize();
  if (originalViewport && originalViewport.width < 768)
    await page.setViewportSize({ width: 900, height: originalViewport.height });
  const viewport = page.getByRole('region', { name: title, exact: true });
  await viewport.focus();
  await viewport.press(locale === 'fa' ? 'ArrowLeft' : 'ArrowRight');
  await expect(viewport).toBeFocused();
  if (name === 'uploads')
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
  if (originalViewport) await page.setViewportSize(originalViewport);
}
for (const locale of ['en', 'fa'] as const) {
  const r = (key: string) => t(`admin.roles.${key}`, locale),
    u = (key: string) => t(`admin.uploadPolicies.${key}`, locale);
  const refresh = t('admin.jobs.refresh', locale),
    retry = t('admin.jobs.reload', locale);
  test(`role catalogue recovers and opens isolated staff permission lookup (${locale})`, async ({
    page,
  }, info) => {
    await shell(page, locale);
    let fail = false,
      deny = false,
      lookups = 0,
      lookupDenied = false;
    let initialRoles: Route | undefined;
    await page.route('**/api/admin/roles', (route) => {
      if (!initialRoles) {
        initialRoles = route;
        return;
      }
      return route.fulfill(
        deny
          ? { status: 403, json: {} }
          : fail
            ? { status: 503, json: {} }
            : { json: [catalogueRole] }
      );
    });
    await page.route('**/api/admin/users/*/effective-permissions', (route) => {
      lookups++;
      return route.fulfill({
        status: lookupDenied ? 403 : 200,
        json: lookupDenied ? {} : effectivePermissions,
      });
    });
    await page.goto('/admin/roles');
    await expect(page.getByRole('main').getByRole('status')).toHaveText(
      locale === 'fa' ? 'در حال بارگذاری نقش‌ها…' : 'Loading roles…'
    );
    await expect.poll(() => !!initialRoles).toBe(true);
    await initialRoles!.fulfill({ json: [catalogueRole] });
    const roleLink = page.locator(`main a[href="/admin/roles/${catalogueRole.roleId}"]:visible`);
    await expect(roleLink).toBeVisible();
    await inspect(page, r('catalogue'), locale, info.project.name, 'roles');
    fail = true;
    await page.getByRole('button', { name: refresh, exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(r('load.failed'));
    await expect(roleLink).toHaveCount(0);
    await expect(page.locator('#staffUserId')).toHaveCount(0);
    fail = false;
    await page.getByRole('button', { name: r('retry'), exact: true }).click();
    await expect(roleLink).toBeVisible();
    expect(lookups).toBe(0);
    deny = true;
    await page.getByRole('button', { name: refresh, exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText(r('forbidden'));
    await expect(page.locator('table, [data-slot=card-list-view]')).toHaveCount(0);
    deny = false;
    await page.getByRole('button', { name: refresh, exact: true }).click();
    await expect(roleLink).toBeVisible();
    await page.getByRole('link', { name: r('effective.title'), exact: true }).click();
    await page.locator('[data-permission-id-toggle]').click();
    await page.locator('#staffUserId').fill('staff-one');
    await page.getByRole('button', { name: r('effective.lookup'), exact: true }).click();
    await expect(page.locator('main')).toContainText('staff-one');
    lookupDenied = true;
    await page.getByRole('button', { name: r('effective.lookup'), exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText(r('forbidden'));
    await expect(page.locator('#staffUserId')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText('staff-one');
    expect(lookups).toBe(2);
  });
  test(`upload policy URLs reopen the category editor and its history (${locale})`, async ({
    page,
  }) => {
    await shell(page, locale);
    await page.route('**/api/admin/upload-policies/access', (route) =>
      route.fulfill({ json: { canEdit: true } })
    );
    await page.route('**/api/admin/upload-policies/limits', (route) =>
      route.fulfill({ json: [policyLimit] })
    );
    let categoryReads = 0;
    await page.route('**/api/admin/upload-policies?category=document', (route) => {
      categoryReads++;
      return route.fulfill({ json: [uploadPolicy] });
    });
    const versionPath = `/admin/upload-policies/document/versions/${uploadPolicy.id}`;
    await page.route(`**/api${versionPath}`, (route) => route.fulfill({ json: uploadPolicy }));
    await page.goto('/admin/upload-policies?history=document');
    await expect(page).toHaveURL('/admin/upload-policies/document/history');
    await page.getByRole('link', { name: u('version'), exact: true }).click();
    await expect(page).toHaveURL(versionPath);
    await page.reload();
    await expect(page.getByRole('main')).toContainText(uploadPolicy.createdBy);
    expect(categoryReads).toBe(1);
    await page.getByRole('link', { name: u('edit'), exact: true }).click();
    await expect(page).toHaveURL('/admin/upload-policies/document/edit');
    const size = page.locator('#upload-policy-size');
    await expect(size).toBeVisible();
    const persistedSize = await size.inputValue();
    await size.fill('1.5');
    await page.reload();
    await expect(size).toHaveValue(persistedSize);
    await page.goBack();
    await expect(page).toHaveURL(versionPath);
    await expect(size).toHaveCount(0);
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
    await page.route('**/api/admin/upload-policies?category=document', (route) =>
      route.fulfill(fail ? { status: 503, json: {} } : { json: [uploadPolicy] })
    );
    await page.goto('/admin/upload-policies');
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await page.setViewportSize({ width: 900, height: 844 });
    await inspect(page, u('catalogue'), locale, info.project.name, 'uploads');
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByRole('link', { name: `${u('edit')} ${u('category.document')}`, exact: true })
      .click();
    const dialog = page.getByRole('main');
    const size = dialog.getByRole('spinbutton', { name: /\S/ });
    const formats = dialog.getByRole('group', { name: u('formats'), exact: true });
    await expect(size).toHaveAttribute('aria-required', 'true');
    await expect(size).toHaveAccessibleDescription(
      await dialog.locator('#upload-policy-size-ceiling').innerText()
    );
    await expect(formats).toHaveAccessibleDescription(storagePolicyFormText('extensions', locale));
    await size.fill('1.5');
    fail = true;
    await dialog.getByRole('button', { name: refresh, exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText(u('loadError'));
    await expect(dialog.locator('#upload-policy-size')).toHaveValue('1.5');
    await expect(dialog.getByRole('button', { name: u('save'), exact: true })).toBeDisabled();
    fail = false;
    const reads = accesses;
    await dialog.getByRole('button', { name: retry, exact: true }).click();
    await expect(dialog.getByRole('button', { name: u('save'), exact: true })).toBeEnabled();
    expect(accesses).toBe(reads);
    await expect(dialog.locator('#upload-policy-size')).toHaveValue('1.5');
    await dialog.locator('#upload-policy-size').fill('1');
    await expect(dialog.locator('#upload-policy-size')).toHaveValue('1');
    expect((await new AxeBuilder({ page }).include('form').analyze()).violations).toEqual([]);
    if (locale === 'fa' && info.project.name === 'mobile-safari')
      await page.screenshot({
        path: '/tmp/barghsa-policy-catalogue-editor-fa-mobile-safari.png',
        fullPage: true,
      });
    ceiling = 1048576;
    await dialog.getByRole('button', { name: refresh, exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText(storagePolicyFormText('changed', locale));
    await expect(dialog.locator('#upload-policy-size')).toHaveValue('1');
    await expect(dialog.getByRole('button', { name: u('save'), exact: true })).toBeDisabled();
    await dialog
      .getByRole('button', { name: storagePolicyFormText('reset', locale), exact: true })
      .click();
    await expect(dialog.locator('#upload-policy-size')).toHaveValue('1');
    await expect(dialog.getByRole('button', { name: u('save'), exact: true })).toBeEnabled();
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
