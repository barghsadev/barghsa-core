import { productionManifest } from './production-manifest';
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
    await page.goto('/admin/electricity-rules/rules/edit');
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
  test(`wizard retention and template history recover reviewed values (${locale})`, async ({
    page,
  }) => {
    await setupCatalogueForms(page, locale, locale === 'fa');
    await reads(page);
    const label = (key: string) => t(`admin.green.${key}`, locale);
    let days = 13;
    let selected = templateId as string | null;
    await page.route(`**${base}/wizard-draft-ttl`, (route) => route.fulfill({ json: { days } }));
    await page.route(`**${base}/electricity-contract-template`, (route) =>
      route.fulfill({ json: { ...templateSetting, selectedVersionId: selected } })
    );
    const settings = [
      {
        path: 'wizard-draft-ttl',
        title: 'retentionRecoveryTitle',
        region: 'draft-retention-recovery',
        field: '#electricity-draft-ttl',
        before: '13',
        after: '7',
        config: { days: 7 },
        apply: () => {
          days = 7;
        },
      },
      {
        path: 'electricity-contract-template',
        title: 'templateRecoveryTitle',
        region: 'contract-template-recovery',
        field: '#electricity-contract-template',
        before: templateId,
        after: '',
        config: { versionId: null },
        apply: () => {
          selected = null;
        },
      },
    ];
    for (const { path, title, region, field, before, after, config, apply } of settings) {
      const revision = { id: '33333333-3333-4333-8333-333333333333', version: 1, config };
      const draft = {
        id: '44444444-4444-4444-8444-444444444444',
        baseVersion: 2,
        sourceId: revision.id,
        sourceVersion: 1,
        config,
      };
      let pending: typeof draft | null = null;
      let version = 2;
      const commands: unknown[] = [];
      await page.route(`**${base}/${path}/rollback-history`, (route) =>
        route.fulfill({
          json: {
            baseVersion: version,
            items: [revision],
            draft: pending,
            nextBeforeVersion: null,
          },
        })
      );
      await page.route(`**${base}/${path}/rollback-draft`, (route) => {
        commands.push(route.request().postDataJSON());
        pending = draft;
        return route.fulfill({ status: 201, json: draft });
      });
      await page.route(`**${base}/${path}/rollback-activate`, (route) => {
        commands.push(route.request().postDataJSON());
        version = 3;
        pending = null;
        apply();
        return route.fulfill({ json: { config, version, draftId: draft.id } });
      });
      const section = path === 'wizard-draft-ttl' ? 'retention' : 'template';
      const overview = '/admin/electricity-rules/' + section;
      await page.goto(overview + '/edit');
      await expect(page.locator(field)).toHaveValue(before);
      const back = page.locator(`main a[href="${overview}"]`);
      await back.click();
      await expect(page.locator(field)).toHaveCount(0);
      await page.getByRole('link', { name: label(title), exact: true }).click();
      await expect(page).toHaveURL(overview + '/history');
      await expect(page.locator(field)).toHaveCount(0);
      const panel = page.locator(`#${region}`);
      const dialog = page.getByRole('dialog');
      const confirm = dialog.getByRole('button', {
        name: locale === 'fa' ? 'تأیید' : 'Confirm',
        exact: true,
      });
      await panel
        .getByRole('button', {
          name: label('recoveryStage').replace('{version}', locale === 'fa' ? '۱' : '1'),
          exact: true,
        })
        .click();
      await expect(dialog).toContainText(label('settingsRecoveryStageConfirm'));
      await confirm.click();
      const activate = panel.getByRole('button', { name: label('recoveryActivate'), exact: true });
      await expect(activate).toBeVisible();
      await expect(page.locator(field)).toHaveCount(0);
      expect(commands).toEqual([{ sourceId: revision.id, expectedVersion: 2 }]);
      expect((await new AxeBuilder({ page }).include(`#${region}`).analyze()).violations).toEqual(
        []
      );
      await activate.click();
      await expect(dialog).toContainText(label('settingsRecoveryActivateConfirm'));
      await confirm.click();
      await expect(activate).toHaveCount(0);
      await back.click();
      const editTitle = section === 'retention' ? 'editRetention' : 'editTemplate';
      await page.getByRole('link', { name: label(editTitle), exact: true }).click();
      await expect(page.locator(field)).toHaveValue(after);
      expect(commands).toEqual([
        { sourceId: revision.id, expectedVersion: 2 },
        { draftId: draft.id, expectedVersion: 2 },
      ]);
    }
  });

for (const locale of ['en', 'fa'] as const)
  test(`green rules recovery keeps the active revision until separate confirmation (${locale})`, async ({
    page,
  }) => {
    await setupCatalogueForms(page, locale, locale === 'fa');
    await reads(page);
    const label = (key: string) => t(`admin.green.${key}`, locale);
    const revision = {
      id: '33333333-3333-4333-8333-333333333333',
      version: 1,
      config: greenConfig,
    };
    const draft = {
      id: '44444444-4444-4444-8444-444444444444',
      baseVersion: 2,
      sourceId: revision.id,
      sourceVersion: revision.version,
      config: greenConfig,
    };
    let active = {
      ...greenConfig,
      simpleOrder: { ...greenConfig.simpleOrder, averagePowerThresholdKw: 1250 },
    };
    let version = 2;
    let pending: typeof draft | null = null;
    const stageCommands: unknown[] = [],
      activationCommands: unknown[] = [];
    const path = `${base}/green-electricity-rules`;
    await page.route(`**${path}`, (route) => route.fulfill({ json: active }));
    await page.route(`**${path}/rollback-history`, (route) =>
      route.fulfill({
        json: { baseVersion: version, items: [revision], nextBeforeVersion: null, draft: pending },
      })
    );
    await page.route(`**${path}/rollback-draft`, (route) => {
      stageCommands.push(route.request().postDataJSON());
      pending = draft;
      return route.fulfill({ status: 201, json: draft });
    });
    await page.route(`**${path}/rollback-activate`, (route) => {
      activationCommands.push(route.request().postDataJSON());
      version = 3;
      active = greenConfig;
      pending = null;
      return route.fulfill({ json: { config: active, version, draftId: draft.id } });
    });
    const history = page
      .getByRole('main')
      .getByRole('link', { name: label('recoveryTitle'), exact: true });
    const threshold = page.locator('#simpleOrder-threshold');
    const dialog = page.getByRole('dialog');
    const confirm = dialog.getByRole('button', {
      name: locale === 'fa' ? 'تأیید' : 'Confirm',
      exact: true,
    });
    const activate = page.getByRole('button', { name: label('recoveryActivate'), exact: true });
    await page.goto('/admin/electricity-rules');
    const summary = page.getByTestId('saved-electricity-rules');
    await expect(summary).toContainText((1250).toLocaleString(locale));
    await expect(threshold).toHaveCount(0);
    await history.click();
    await expect(page).toHaveURL('/admin/electricity-rules/history');
    await page
      .getByRole('button', {
        name: label('recoveryStage').replace('{version}', locale === 'fa' ? '۱' : '1'),
        exact: true,
      })
      .click();
    await expect(dialog).toContainText(label('recoveryStageConfirm'));
    await confirm.click();
    await expect(activate).toBeVisible();
    expect(stageCommands).toEqual([{ sourceId: revision.id, expectedVersion: 2 }]);
    expect(activationCommands).toEqual([]);
    expect(active.simpleOrder.averagePowerThresholdKw).toBe(1250);
    await page.reload();
    await expect(activate).toBeVisible();
    await expect(page.getByRole('main')).toContainText(
      label('recoveryCurrent').replace('{version}', locale === 'fa' ? '۲' : '2')
    );
    expect(
      (await new AxeBuilder({ page }).include('#green-rule-recovery').analyze()).violations
    ).toEqual([]);
    await activate.click();
    await expect(dialog).toContainText(label('recoveryActivateConfirm'));
    await confirm.click();
    await expect(activate).toHaveCount(0);
    await page
      .getByRole('main')
      .getByRole('link', { name: label('quoteRules'), exact: true })
      .click();
    await expect(summary).toContainText((1000).toLocaleString(locale));
    await page.getByRole('link', { name: label('editRules'), exact: true }).click();
    await expect(threshold).toHaveValue('1000');
    expect(activationCommands).toEqual([{ draftId: draft.id, expectedVersion: 2 }]);
  });

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
      const main = page.getByRole('main');
      await expect(main.locator('form')).toHaveCount(0);
      await main.getByRole('link', { name: label('editRules'), exact: true }).click();
      await expect(page).toHaveURL('/admin/electricity-rules/rules/edit');
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
      await expect(ttl).toHaveCount(0);
      if (await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) {
        for (const mode of ['simpleOrder', 'advancedOrder']) {
          const share = page.locator('#' + mode + '-share');
          const toggle = page.locator(`label[for="${mode}-enabled"]`);
          for (const target of [share, toggle]) {
            await expect(target).toBeVisible();
            const { height, width } = (await target.boundingBox())!;
            expect(height).toBeGreaterThanOrEqual(44);
            expect(width).toBeGreaterThanOrEqual(44);
          }
        }
      }
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'fa' ? 'rtl' : 'ltr');
      await expect(page.locator('html')).toHaveClass(dark ? /dark/ : /^(?!.*dark).*$/);
      await simple.fill('1e3');
      await saveRules.click();
      await expect(simple).toBeFocused();
      await expect(simple).toHaveAttribute('aria-invalid', 'true');
      await expect(dialog).toHaveCount(0);
      expect(writes).toEqual([]);
      await expect(template).toHaveCount(0);
      const raw = locale === 'fa' ? ' ۱۷۵۰ ' : ' ١٧٥٠ ';
      await simple.fill(raw);
      const share = page.locator('#simpleOrder-share');
      await share.fill('۱۰۰٫۱');
      await saveRules.click();
      await expect(share).toBeFocused();
      await expect(share).toHaveAttribute('aria-invalid', 'true');
      await expect(dialog).toHaveCount(0);
      expect(writes).toEqual([]);
      await share.fill(locale === 'fa' ? ' ۴٫۵ ' : ' ٤٫٥ ');
      await saveRules.click();
      await expect(dialog).toContainText(label('enabledState'));
      await confirm.click();
      await expect(dialog).toHaveCount(0);
      await expect(simple).toHaveValue('1750');
      await expect(share).toHaveValue('4.5');
      expect(writes[0]).toMatchObject({
        simpleOrder: { averagePowerThresholdKw: 1750, mandatoryGreenSharePercent: 4.5 },
      });
      await expect(page.getByRole('main')).toContainText(label('quoteImpact'));
      await main.locator('header a[href="/admin/electricity-rules"]').click();
      await page
        .getByRole('main')
        .getByRole('link', { name: label('draftTtlTitle'), exact: true })
        .click();
      await expect(ttl).toHaveCount(0);
      const links = page.getByRole('navigation', { name: label('title'), exact: true });
      await expect(links.locator('[aria-current="page"]')).toHaveCount(1);
      await expect(
        links.getByRole('link', { name: label('draftTtlTitle'), exact: true })
      ).toHaveAttribute('aria-current', 'page');
      await main.getByRole('link', { name: label('editRetention'), exact: true }).click();
      await expect(ttl).toHaveValue('7');
      await ttl.fill('366');
      await saveTtl.click();
      await expect(ttl).toBeFocused();
      await expect(ttl).toHaveAttribute('aria-invalid', 'true');
      expect(writes).toHaveLength(1);
      await ttl.fill(' ۱۴ ');
      await saveTtl.click();
      await confirm.click();
      await expect(dialog).toHaveCount(0);
      await expect(ttl).toBeFocused();
      await expect(ttl).toHaveValue(' ۱۴ ');
      await expect(ttl).toHaveAttribute('aria-invalid', 'true');
      await expect(page.locator('main[data-area=admin]')).not.toContainText('PRIVATE_MESSAGE');
      ttlPhase = 'success';
      await saveTtl.click();
      await confirm.click();
      await expect(dialog).toHaveCount(0);
      await expect(ttl).toHaveValue('14');
      await main.locator('header a[href="/admin/electricity-rules/retention"]').click();
      await page
        .getByRole('main')
        .getByRole('link', { name: label('templateTitle'), exact: true })
        .click();
      await expect(template).toHaveCount(0);
      await main.getByRole('link', { name: label('editTemplate'), exact: true }).click();
      await expect(
        template.locator('option').filter({ hasText: 'Retired agreement' })
      ).toBeDisabled();
      await template.selectOption(templateId);
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
      await expect(template).toHaveValue(templateId);
      expect(
        (await new AxeBuilder({ page }).include('main[data-area=admin]').analyze()).violations
      ).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      if (locale === 'fa' && dark && testInfo.project.name === 'mobile-safari') {
        const viewport = page.viewportSize()!;
        await page.setViewportSize({ ...viewport, height: 1400 });
        for (const [key, name, path] of [
          ['ruleEditor', 'green', '/admin/electricity-rules/rules/edit'],
          ['draftTtlTitle', 'retention', '/admin/electricity-rules/retention/edit'],
          ['templateTitle', 'template', '/admin/electricity-rules/template/edit'],
        ]) {
          await page.goto(path!);
          await page.getByRole('form', { name: label(key!), exact: true }).screenshot({
            path: `/tmp/barghsa-electricity-settings-${name}-fa-dark-mobile.png`,
          });
        }
        await page.setViewportSize(viewport);
      }
      await page.goto('/admin/electricity-rules/retention/edit');
      await expect(ttl).toHaveValue('14');
      await page.goto('/admin/electricity-rules/rules/edit');
      await expect(simple).toHaveValue('1750');
      denied = true;
      await simple.fill('1900');
      await saveRules.click();
      await confirm.click();
      await expect(dialog).toHaveCount(0);
      await expect(page.locator('main[data-area=admin]')).toContainText(label('forbidden'));
      for (const field of [simple, ttl, template]) await expect(field).toHaveCount(0);
    });

for (const locale of ['en', 'fa'] as const) {
  test(`electricity deferred validation locks forms and refresh cancels obsolete work (${locale})`, async ({
    page,
  }) => {
    await setupCatalogueForms(page, locale, locale === 'fa');
    await reads(page);
    const label = (key: string) => t(`admin.green.${key}`, locale);
    const manifest = (await productionManifest()) as Record<string, { file: string }>;
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
      await page.goto('/admin/electricity-rules/retention/edit');
      const ttl = page.locator('#electricity-draft-ttl');
      await expect(ttl).toHaveValue('7');
      await ttl.fill('14');
      await page.getByRole('button', { name: label('draftTtlSave'), exact: true }).click();
      await seen;
      await expect(ttl).toBeDisabled();
      await expect(
        page.locator('#simpleOrder-threshold, #electricity-contract-template')
      ).toHaveCount(0);
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
    const manifest = (await productionManifest()) as Record<string, { file: string }>;
    await page.route(`**/${manifest['src/lib/catalogue-form-schemas.ts'].file}`, (route) =>
      route.abort()
    );
    let writes = 0;
    page.on('request', (request) => {
      if (request.method() === 'PUT' && request.url().includes(base)) writes++;
    });
    await page.goto('/admin/electricity-rules/retention/edit');
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
