import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { t } from '../../../packages/i18n/src/admin-ui';
import { test, expect } from './coverage-fixture';
import { setupCatalogueForms } from './catalogue-form-fixture';
import {
  greenConfig,
  greenSafety,
  templateSetting,
  templateId,
} from '../src/test/electricity-settings-fixtures';
const base = '/api/admin/config';
for (const locale of ['en', 'fa'] as const)
  test(`electricity limit conflict is localized and permits disabling the rule (${locale})`, async ({
    page,
  }) => {
    await setupCatalogueForms(page, locale, locale === 'fa');
    await reads(page);
    await page.route(`**${base}/green-electricity-rules/safety-status`, (route) =>
      route.fulfill({
        json: { ...greenSafety, simpleOrder: { blocked: true, reasons: ['limits_incompatible'] } },
      })
    );
    let config = structuredClone(greenConfig);
    const writes: unknown[] = [];
    await page.route(`**${base}/green-electricity-rules`, (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: config });
      config = route.request().postDataJSON();
      writes.push(config);
      return route.fulfill({ json: config });
    });
    const label = (key: string) => t(`admin.green.${key}`, locale);
    await page.goto('/admin/electricity-rules');
    await expect(page.getByRole('alert')).toContainText(label('limits_incompatible'));
    const save = page.getByRole('button', { name: label('save'), exact: true });
    await save.click();
    await expect(page.locator('#simpleOrder-enabled')).toBeFocused();
    expect(writes).toEqual([]);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.locator('#simpleOrder-enabled').uncheck();
    await save.click();
    const dialog = page.getByRole('dialog');
    await dialog
      .getByRole('button', { name: locale === 'fa' ? 'تأیید' : 'Confirm', exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    expect(writes).toEqual([
      { ...greenConfig, simpleOrder: { ...greenConfig.simpleOrder, mandatoryGreenEnabled: false } },
    ]);
  });
async function reads(page: Page) {
  await page.route(`**${base}/green-electricity-rules`, (route) =>
    route.fulfill({ json: greenConfig })
  );
  await page.route(`**${base}/green-electricity-rules/safety-status`, (route) =>
    route.fulfill({ json: greenSafety })
  );
  await page.route(`**${base}/wizard-draft-ttl`, (route) => route.fulfill({ json: { days: 7 } }));
  await page.route(`**${base}/electricity-contract-template`, (route) =>
    route.fulfill({ json: templateSetting })
  );
}
for (const locale of ['en', 'fa'] as const)
  for (const dark of [false, true])
    test(`electricity settings validate and recover all three editors (${locale}, dark=${dark})`, async ({
      page,
    }, testInfo) => {
      await setupCatalogueForms(page, locale, dark);
      await reads(page);
      const label = (key: string) => t(`admin.green.${key}`, locale);
      let config = structuredClone(greenConfig),
        days = 7,
        selected: string | null = null;
      let ttlPhase: 'field' | 'success' = 'field',
        templatePhase: 'mismatch' | 'success' = 'mismatch',
        denied = false;
      const writes: unknown[] = [];
      await page.route(`**${base}/green-electricity-rules`, (route) => {
        if (route.request().method() === 'GET') return route.fulfill({ json: config });
        writes.push(route.request().postDataJSON());
        if (denied) return route.fulfill({ status: 403, json: { error: 'AUTHZ:FORBIDDEN' } });
        config = route.request().postDataJSON();
        return route.fulfill({ json: config });
      });
      await page.route(`**${base}/wizard-draft-ttl`, (route) => {
        if (route.request().method() === 'GET') return route.fulfill({ json: { days } });
        writes.push(route.request().postDataJSON());
        if (ttlPhase === 'field')
          return route.fulfill({
            status: 400,
            json: {
              error: {
                code: 'VALIDATION:INPUT:INVALID',
                fields: ['days'],
                message: 'PRIVATE_MESSAGE',
              },
            },
          });
        days = route.request().postDataJSON().days;
        return route.fulfill({ json: { days } });
      });
      await page.route(`**${base}/electricity-contract-template`, (route) => {
        if (route.request().method() === 'GET')
          return route.fulfill({ json: { ...templateSetting, selectedVersionId: selected } });
        writes.push(route.request().postDataJSON());
        if (templatePhase === 'success') selected = route.request().postDataJSON().versionId;
        return route.fulfill({ json: { ...templateSetting, selectedVersionId: selected } });
      });
      await page.goto('/admin/electricity-rules');
      const simple = page.locator('#simpleOrder-threshold'),
        ttl = page.locator('#electricity-draft-ttl'),
        template = page.locator('#electricity-contract-template');
      const saveRules = page.getByRole('button', { name: label('save'), exact: true }),
        saveTtl = page.getByRole('button', { name: label('draftTtlSave'), exact: true }),
        saveTemplate = page.getByRole('button', { name: label('templateSave'), exact: true });
      const dialog = page.getByRole('dialog'),
        confirm = dialog.getByRole('button', {
          name: locale === 'fa' ? 'تأیید' : 'Confirm',
          exact: true,
        }),
        cancel = dialog.getByRole('button', {
          name: locale === 'fa' ? 'انصراف' : 'Cancel',
          exact: true,
        });
      await expect(ttl).toHaveValue('7');
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'fa' ? 'rtl' : 'ltr');
      await expect(page.locator('html')).toHaveClass(dark ? /dark/ : /^(?!.*dark).*$/);
      await simple.fill('1e3');
      await saveRules.click();
      await expect(simple).toBeFocused();
      await expect(simple).toHaveAttribute('aria-invalid', 'true');
      await expect(dialog).toHaveCount(0);
      await ttl.fill('366');
      await saveTtl.click();
      await expect(ttl).toBeFocused();
      await expect(ttl).toHaveAttribute('aria-invalid', 'true');
      expect(writes).toEqual([]);
      await expect(
        template.locator('option').filter({ hasText: 'Retired agreement' })
      ).toBeDisabled();
      const raw = locale === 'fa' ? ' ۱۷۵۰ ' : ' ١٧٥٠ ';
      await simple.fill(raw);
      await ttl.fill(' ۱۴ ');
      await template.selectOption(templateId);
      await saveRules.click();
      await expect(dialog).toContainText(label('enabledState'));
      await confirm.click();
      await expect(dialog).toHaveCount(0);
      await expect(simple).toHaveValue('1750');
      await expect(ttl).toHaveValue(' ۱۴ ');
      await expect(template).toHaveValue(templateId);
      expect(writes[0]).toMatchObject({ simpleOrder: { averagePowerThresholdKw: 1750 } });
      await saveTtl.click();
      await confirm.click();
      await expect(dialog).toHaveCount(0);
      await expect(ttl).toBeFocused();
      await expect(ttl).toHaveValue(' ۱۴ ');
      await expect(ttl).toHaveAttribute('aria-invalid', 'true');
      await expect(page.locator('#admin-content')).not.toContainText('PRIVATE_MESSAGE');
      ttlPhase = 'success';
      await saveTtl.click();
      await confirm.click();
      await expect(dialog).toHaveCount(0);
      await expect(ttl).toHaveValue('14');
      await saveTemplate.click();
      await expect(dialog).toContainText('Supply agreement');
      await confirm.click();
      await expect(confirm).toBeDisabled();
      await expect(dialog).toContainText(label('unverified'));
      await cancel.click();
      await expect(saveTemplate).toBeDisabled();
      await expect(template).toHaveValue(templateId);
      await page.getByRole('button', { name: label('refresh'), exact: true }).click();
      await expect(saveTemplate).toBeEnabled();
      templatePhase = 'success';
      await saveTemplate.click();
      await confirm.click();
      await expect(dialog).toHaveCount(0);
      await expect(template).toHaveValue(templateId);
      expect(selected).toBe(templateId);
      await page.reload();
      await expect(simple).toHaveValue('1750');
      await expect(ttl).toHaveValue('14');
      await expect(template).toHaveValue(templateId);
      expect(
        (await new AxeBuilder({ page }).include('#admin-content').analyze()).violations
      ).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      if (locale === 'fa' && dark && testInfo.project.name === 'mobile-safari') {
        const viewport = page.viewportSize()!;
        await page.setViewportSize({ ...viewport, height: 1400 });
        for (const [key, name] of [
          ['ruleEditor', 'green'],
          ['draftTtlTitle', 'retention'],
          ['templateTitle', 'template'],
        ])
          await page.getByRole('form', { name: label(key), exact: true }).screenshot({
            path: `/tmp/barghsa-electricity-settings-${name}-fa-dark-mobile.png`,
          });
        await page.setViewportSize(viewport);
      }
      denied = true;
      await simple.fill('1900');
      await saveRules.click();
      await confirm.click();
      await expect(dialog).toHaveCount(0);
      await expect(page.locator('#admin-content')).toContainText(label('forbidden'));
      for (const field of [simple, ttl, template]) await expect(field).toHaveCount(0);
    });

for (const locale of ['en', 'fa'] as const) {
  test(`electricity deferred validation locks forms and refresh cancels obsolete work (${locale})`, async ({
    page,
  }) => {
    await setupCatalogueForms(page, locale, locale === 'fa');
    await reads(page);
    const label = (key: string) => t(`admin.green.${key}`, locale);
    const manifest = JSON.parse(await readFile('dist/.vite/manifest.json', 'utf8')) as Record<
      string,
      { file: string }
    >;
    const asset = manifest['src/lib/catalogue-form-schemas.ts'].file;
    let release!: () => void, requested!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
      }),
      seen = new Promise<void>((resolve) => {
        requested = resolve;
      });
    await page.route(`**/${asset}`, async (route) => {
      requested();
      await gate;
      await route.continue();
    });
    try {
      await page.goto('/admin/electricity-rules');
      const ttl = page.locator('#electricity-draft-ttl');
      await expect(ttl).toHaveValue('7');
      await ttl.fill('14');
      await page.getByRole('button', { name: label('draftTtlSave'), exact: true }).click();
      await seen;
      for (const id of [
        'simpleOrder-threshold',
        'electricity-draft-ttl',
        'electricity-contract-template',
      ])
        await expect(page.locator(`#${id}`)).toBeDisabled();
      await page.route(`**${base}/wizard-draft-ttl`, (route) =>
        route.fulfill({ json: { days: 9 } })
      );
      await page.getByRole('button', { name: label('refresh'), exact: true }).click();
      await expect(ttl).toHaveValue('9');
      release();
      await expect(
        page.getByRole('button', { name: label('draftTtlSave'), exact: true })
      ).toBeEnabled();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await page.getByRole('button', { name: label('draftTtlSave'), exact: true }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
    } finally {
      release();
    }
  });
  test(`electricity missing validator keeps raw values and prevents writes (${locale})`, async ({
    page,
  }) => {
    await setupCatalogueForms(page, locale, locale === 'fa');
    await reads(page);
    const label = (key: string) => t(`admin.green.${key}`, locale);
    const manifest = JSON.parse(await readFile('dist/.vite/manifest.json', 'utf8')) as Record<
      string,
      { file: string }
    >;
    await page.route(`**/${manifest['src/lib/catalogue-form-schemas.ts'].file}`, (route) =>
      route.abort()
    );
    let writes = 0;
    page.on('request', (request) => {
      if (request.method() === 'PUT' && request.url().includes(base)) writes++;
    });
    await page.goto('/admin/electricity-rules');
    const ttl = page.locator('#electricity-draft-ttl');
    await expect(ttl).toHaveValue('7');
    await ttl.fill(' ۱۴ ');
    await page.getByRole('button', { name: label('draftTtlSave'), exact: true }).click();
    await expect(
      page.getByRole('form', { name: label('draftTtlTitle'), exact: true })
    ).toContainText(label('validationUnavailable'));
    await expect(ttl).toHaveValue(' ۱۴ ');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(writes).toBe(0);
  });
}
