import { test, expect } from './coverage-fixture';
import { setupCatalogueForms } from './catalogue-form-fixture';
import { t } from '@barghsa/i18n/admin-ui';
import { storagePolicyFormText } from '@barghsa/i18n/storage-policy-forms';
import { policyLimit, uploadPolicy } from '../src/test/policy-catalogue-fixtures';
import AxeBuilder from '@axe-core/playwright';
test.use({ viewport: { width: 390, height: 844 } });
const initial = {
  endpoint: 'https://objects.example.test',
  region: 'us-east-1',
  bucket: 'documents',
  accessKeyId: 'stored-key',
  hasSecretKey: true,
  forcePathStyle: true,
  privateEndpointUrl: '',
  publicEndpointUrl: '',
  version: 7,
};
for (const locale of ['en', 'fa'] as const)
  for (const dark of [false, true]) {
    test(`storage and policy forms retain owned feedback (${locale}, ${dark ? 'dark' : 'light'})`, async ({
      page,
    }, info) => {
      await setupCatalogueForms(page, locale, dark);
      const storage = (key: string) => t(`admin.storage.${key}`, locale),
        policy = (key: string) => t(`admin.uploadPolicies.${key}`, locale);
      let config = { ...initial },
        cleanup = { hours: 24, version: 3 },
        savedPolicy = { ...uploadPolicy };
      const storageWrites: unknown[] = [],
        cleanupWrites: unknown[] = [],
        policyWrites: unknown[] = [];
      await page.route('**/api/admin/storage/config', (route) => {
        if (route.request().method() === 'GET') return route.fulfill({ json: config });
        const body = route.request().postDataJSON();
        storageWrites.push(body);
        if (storageWrites.length === 1)
          return route.fulfill({
            status: 400,
            json: {
              error: {
                code: 'VALIDATION:INPUT:INVALID',
                fields: ['bucket'],
                message: 'private-server-value',
              },
            },
          });
        const { secretAccessKey: _secret, ...publicFields } = body;
        config = { ...config, ...publicFields, hasSecretKey: true, version: config.version + 1 };
        return route.fulfill({ json: config });
      });
      await page.route('**/api/admin/storage/multipart-cleanup-policy', (route) => {
        if (route.request().method() === 'GET') return route.fulfill({ json: cleanup });
        const body = route.request().postDataJSON();
        cleanupWrites.push(body);
        if (cleanupWrites.length === 1)
          return route.fulfill({
            status: 400,
            json: {
              error: {
                code: 'VALIDATION:INPUT:INVALID',
                fields: ['hours'],
                message: 'private-server-value',
              },
            },
          });
        cleanup = { ...body, version: cleanup.version + 1 };
        return route.fulfill({ json: cleanup });
      });
      const confirm = () =>
        page
          .getByRole('dialog')
          .getByRole('button', { name: locale === 'fa' ? 'تأیید' : 'Confirm', exact: true })
          .click();
      await page.goto('/admin/storage');
      const bucket = page.locator('#storage-bucket'),
        secret = page.locator('#storage-secret');
      await secret.fill('retained-secret');
      await bucket.fill(' ');
      await page.getByRole('button', { name: storage('save'), exact: true }).click();
      await expect(bucket).toBeFocused();
      expect(storageWrites).toHaveLength(0);
      await bucket.fill('new-documents');
      await page.getByRole('button', { name: storage('save'), exact: true }).click();
      await confirm();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(bucket).toBeFocused();
      await expect(secret).toHaveValue('retained-secret');
      await expect(page.locator('main')).not.toContainText('private-server-value');
      const error = await bucket.getAttribute('aria-describedby');
      expect(error).toBeTruthy();
      await expect(page.locator(`[id="${error}"]`)).toContainText(
        storagePolicyFormText('bucket', locale)
      );
      expect((await new AxeBuilder({ page }).include('form').analyze()).violations).toEqual([]);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
      if (locale === 'fa' && dark)
        await page
          .getByRole('form', { name: storage('title'), exact: true })
          .screenshot({ path: `/tmp/barghsa-storage-form-fa-dark-${info.project.name}.png` });
      await page.getByRole('button', { name: storage('save'), exact: true }).click();
      await confirm();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(secret).toHaveValue('');
      expect(storageWrites).toHaveLength(2);
      expect(storageWrites[1]).toEqual(storageWrites[0]);
      await secret.fill('unsaved-companion');
      const hours = page.locator('#storage-cleanup-hours');
      await hours.fill('1.5');
      await page.getByRole('button', { name: storage('cleanupSave'), exact: true }).click();
      await expect(hours).toBeFocused();
      expect(cleanupWrites).toHaveLength(0);
      await hours.fill('48');
      await page.getByRole('button', { name: storage('cleanupSave'), exact: true }).click();
      await confirm();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(hours).toBeFocused();
      await expect(secret).toHaveValue('unsaved-companion');
      await page.getByRole('button', { name: storage('cleanupSave'), exact: true }).click();
      await confirm();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(cleanupWrites).toEqual([
        { hours: 48, version: 3 },
        { hours: 48, version: 3 },
      ]);
      await expect(secret).toHaveValue('unsaved-companion');
      await page.route('**/api/admin/upload-policies/access', (route) =>
        route.fulfill({ json: { canEdit: true } })
      );
      await page.route('**/api/admin/upload-policies/limits', (route) =>
        route.fulfill({ json: [policyLimit] })
      );
      await page.route('**/api/admin/upload-policies', (route) => {
        if (route.request().method() === 'GET') return route.fulfill({ json: [savedPolicy] });
        const body = route.request().postDataJSON();
        policyWrites.push(body);
        if (policyWrites.length === 1)
          return route.fulfill({
            status: 400,
            json: {
              error: {
                code: 'VALIDATION:INPUT:INVALID',
                fields: ['maxSizeBytes'],
                message: 'private-server-value',
              },
            },
          });
        savedPolicy = { ...savedPolicy, ...body };
        return route.fulfill({ status: 201, json: savedPolicy });
      });
      await page.goto('/admin/upload-policies');
      await page
        .getByRole('button', {
          name: `${policy('edit')} ${policy('category.document')}`,
          exact: true,
        })
        .click();
      const size = page.locator('#upload-policy-size'),
        pdf = page.getByLabel('.pdf', { exact: true });
      await pdf.uncheck();
      await page.getByRole('button', { name: policy('save'), exact: true }).click();
      await expect(pdf).toBeFocused();
      expect(policyWrites).toHaveLength(0);
      await pdf.check();
      await size.fill('0.0000001');
      await page.getByRole('button', { name: policy('save'), exact: true }).click();
      await expect(size).toBeFocused();
      await expect(pdf).toBeChecked();
      await size.fill('1');
      await page.getByRole('button', { name: policy('save'), exact: true }).click();
      await confirm();
      await expect(size).toBeFocused();
      await expect(pdf).toBeChecked();
      await expect(page.getByRole('dialog')).not.toContainText('private-server-value');
      await expect
        .poll(() =>
          page.getByRole('dialog').evaluate((node) => {
            const overlay = document.querySelector('[data-slot="dialog-overlay"]');
            return [node, ...(overlay ? [overlay] : [])].every(
              (element) =>
                getComputedStyle(element).opacity === '1' &&
                element
                  .getAnimations({ subtree: true })
                  .every((animation) => animation.playState === 'finished')
            );
          })
        )
        .toBe(true);
      expect((await new AxeBuilder({ page }).include('form').analyze()).violations).toEqual([]);
      if (locale === 'fa' && dark)
        await page
          .getByRole('dialog')
          .screenshot({ path: `/tmp/barghsa-upload-policy-form-fa-dark-${info.project.name}.png` });
      await page.getByRole('button', { name: policy('save'), exact: true }).click();
      await confirm();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(policyWrites).toEqual([
        { category: 'document', allowedExtensions: ['.pdf'], maxSizeBytes: 1048576 },
        { category: 'document', allowedExtensions: ['.pdf'], maxSizeBytes: 1048576 },
      ]);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
    });
  }
for (const locale of ['en', 'fa'] as const)
  test(`storage and policy unverified writes require reset (${locale})`, async ({ page }) => {
    await setupCatalogueForms(page, locale, false);
    const storage = (key: string) => t(`admin.storage.${key}`, locale),
      policy = (key: string) => t(`admin.uploadPolicies.${key}`, locale);
    let writes = 0;
    await page.route('**/api/admin/storage/config', (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: initial });
      writes++;
      return route.fulfill({ json: { version: 8 } });
    });
    await page.route('**/api/admin/storage/multipart-cleanup-policy', (route) =>
      route.fulfill({ json: { hours: 24, version: 3 } })
    );
    const confirm = () =>
      page
        .getByRole('dialog')
        .getByRole('button', { name: locale === 'fa' ? 'تأیید' : 'Confirm', exact: true })
        .click();
    await page.goto('/admin/storage');
    await page.locator('#storage-secret').fill('retained-secret');
    await page.getByRole('button', { name: storage('save'), exact: true }).click();
    await confirm();
    await expect(
      page
        .getByRole('dialog')
        .getByRole('button', { name: locale === 'fa' ? 'تأیید' : 'Confirm', exact: true })
    ).toBeDisabled();
    expect(writes).toBe(1);
    await page
      .getByRole('dialog')
      .getByRole('button', { name: storage('refresh'), exact: true })
      .click();
    await page
      .getByRole('button', { name: storagePolicyFormText('reset', locale), exact: true })
      .click();
    await expect(page.locator('#storage-secret')).toHaveValue('');
    await expect(page.getByRole('button', { name: storage('save'), exact: true })).toBeEnabled();
    await page.route('**/api/admin/upload-policies/access', (route) =>
      route.fulfill({ json: { canEdit: true } })
    );
    await page.route('**/api/admin/upload-policies/limits', (route) =>
      route.fulfill({ json: [policyLimit] })
    );
    await page.route('**/api/admin/upload-policies', (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: [uploadPolicy] });
      writes++;
      return route.fulfill({ status: 201, json: { id: uploadPolicy.id } });
    });
    await page.goto('/admin/upload-policies');
    await page
      .getByRole('button', {
        name: `${policy('edit')} ${policy('category.document')}`,
        exact: true,
      })
      .click();
    await page.locator('#upload-policy-size').fill('1');
    await page.getByRole('button', { name: policy('save'), exact: true }).click();
    await confirm();
    await expect(
      page
        .getByRole('dialog')
        .getByRole('button', { name: locale === 'fa' ? 'تأیید' : 'Confirm', exact: true })
    ).toBeDisabled();
    expect(writes).toBe(2);
    await page
      .getByRole('dialog')
      .getByRole('button', { name: t('admin.jobs.refresh', locale), exact: true })
      .click();
    await expect(page.locator('#upload-policy-size')).toHaveValue('1');
    await page
      .getByRole('button', { name: storagePolicyFormText('reset', locale), exact: true })
      .click();
    await expect(page.locator('#upload-policy-size')).toHaveValue('2');
    await expect(page.getByRole('button', { name: policy('save'), exact: true })).toBeEnabled();
  });
