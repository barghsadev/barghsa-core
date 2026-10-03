import { readFile } from 'node:fs/promises';
import { t } from '../../../packages/i18n/src/app';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { test, expect } from './coverage-fixture';
import { setupCatalogueForms } from './catalogue-form-fixture';
import { tCatalogue } from '../../../packages/i18n/src/catalogue';
import {
  catalogueBase as base,
  catalogueId as id,
  hardwareId,
  catalogueProduct,
  catalogueDetail,
  catalogueReferences,
  catalogueConfig,
} from '../src/test/catalogue-fixtures';
import {
  savingAgreement,
  savingAgreementConfig,
  savingInventory,
} from '../src/test/saving-catalogue-fixtures';
type Kind = 'agreement' | 'inventory';
async function open(page: Page, kind: Kind, label: (key: string) => string) {
  await page.goto('/admin/catalogue');
  const type = kind === 'agreement' ? 'saving_plan' : 'hardware';
  await page.getByRole('tab', { name: label(type), exact: true }).click();
  await page
    .getByRole('button', {
      name: `${label('edit')} ${catalogueProduct(type).title[(await page.locator('html').getAttribute('lang')) === 'fa' ? 'fa' : 'en']}`,
      exact: true,
    })
    .click();
  const form = page.getByRole('form', {
    name: label(kind === 'agreement' ? 'agreement' : 'inventory'),
    exact: true,
  });
  await expect(form).toBeVisible();
  return form;
}
async function reads(page: Page, kind: Kind, savingRead: () => unknown) {
  await page.route('**/api/admin/catalogue/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === base) {
      const type = url.searchParams.get('type') as 'hardware' | 'saving_plan';
      return route.fulfill({
        json: [
          catalogueProduct(type, type === 'hardware' && kind === 'agreement' ? hardwareId : id),
        ],
      });
    }
    if (url.pathname.endsWith('/rule-references'))
      return route.fulfill({ json: catalogueReferences });
    if (url.pathname.endsWith('/configuration'))
      return route.fulfill({
        json:
          kind === 'agreement'
            ? { ...catalogueConfig, ...(savingRead() as object) }
            : catalogueConfig,
      });
    if (url.pathname.endsWith('/inventory')) return route.fulfill({ json: savingRead() });
    return route.fulfill({
      json: catalogueDetail(kind === 'agreement' ? 'saving_plan' : 'hardware'),
    });
  });
}
for (const kind of ['agreement', 'inventory'] as const)
  for (const locale of ['en', 'fa'] as const)
    for (const dark of [false, true])
      test(`saving ${kind} validates, retains, verifies, recovers and clears denied work (${locale}, dark=${dark})`, async ({
        page,
      }, testInfo) => {
        await setupCatalogueForms(page, locale, dark);
        const label = (key: string) => tCatalogue(key, locale);
        let config = { ...savingAgreementConfig, agreements: [{ ...savingAgreement }] };
        let inventory = { ...savingInventory, hardwareId: id };
        let readFail = false;
        await reads(page, kind, () => (kind === 'agreement' ? config : inventory));
        const path =
          kind === 'agreement'
            ? `/api/admin/catalogue/saving-plans/${id}/agreements/draft`
            : `/api/admin/catalogue/hardware/${id}/inventory`;
        let phase: 'field' | 'unknown' | 'mismatch' | 'success' | 'denied' = 'field',
          stepUp = false;
        const writes: Record<string, unknown>[] = [];
        const resourcePath =
          kind === 'agreement' ? `/api/admin/catalogue/saving-plans/${id}/configuration` : path;
        await page.route(`**${resourcePath}`, (route) => {
          if (route.request().method() !== 'GET') return route.fallback();
          return readFail
            ? route.fulfill({ status: 503, json: {} })
            : route.fulfill({
                json: kind === 'agreement' ? { ...catalogueConfig, ...config } : inventory,
              });
        });
        await page.route(`**${path}`, (route) => {
          if (route.request().method() === 'GET') return route.fallback();
          const body = route.request().postDataJSON();
          writes.push(body);
          if (phase === 'denied')
            return route.fulfill({ status: 403, json: { error: 'AUTHZ:FORBIDDEN' } });
          if (phase === 'field' || phase === 'unknown')
            return route.fulfill({
              status: 400,
              json: {
                error: {
                  code: 'VALIDATION:INPUT:INVALID',
                  fields: [
                    phase === 'unknown' ? 'private' : kind === 'agreement' ? 'title' : 'stockCount',
                  ],
                  message: 'PRIVATE_BACKEND_MESSAGE',
                },
              },
            });
          if (phase === 'mismatch')
            return route.fulfill({
              json:
                kind === 'agreement'
                  ? { ...savingAgreement, ...body, plan_id: hardwareId }
                  : { ...inventory, ...body, hardwareId },
            });
          if (!stepUp)
            return route.fulfill({ status: 403, json: { error: 'AUTHZ:STEP_UP_REQUIRED' } });
          readFail = true;
          if (kind === 'agreement') {
            config = { ...config, agreements: [{ ...savingAgreement, ...body }] };
            return route.fulfill({ status: 201, json: config.agreements[0] });
          }
          inventory = { ...inventory, ...body };
          return route.fulfill({ json: inventory });
        });
        await page.route('**/api/auth/step-up', (route) => {
          stepUp = true;
          return route.fulfill({ json: { verified: true } });
        });
        const form = await open(page, kind, label);
        await expect(page.locator('html')).toHaveClass(dark ? /dark/ : /^(?!.*dark)/);
        const field = page.locator(
          kind === 'agreement' ? '#saving-agreement-title' : '#saving-stock-count'
        );
        await field.fill(kind === 'agreement' ? ' ' : '1');
        await form
          .getByRole('button', {
            name: label(kind === 'agreement' ? 'saveAgreement' : 'saveInventory'),
            exact: true,
          })
          .click();
        await expect(field).toBeFocused();
        await expect(field).toHaveAttribute('aria-invalid', 'true');
        const errorId = await field.getAttribute('aria-describedby');
        await expect(page.locator(`[id="${errorId}"]`)).toContainText(
          label(kind === 'agreement' ? 'invalidAgreementTitle' : 'invalidStockCount')
        );
        expect(
          (
            await new AxeBuilder({ page })
              .include(
                `form[aria-label="${label(kind === 'agreement' ? 'agreement' : 'inventory')}"]`
              )
              .analyze()
          ).violations
        ).toEqual([]);
        const raw = kind === 'agreement' ? '  New saved terms  ' : ' ۰۱۲ ';
        await field.fill(raw);
        if (kind === 'inventory') await page.locator('#saving-reservation-minutes').fill(' ٣٠ ');
        await form.evaluate((el) => {
          (el as HTMLFormElement).requestSubmit();
          (el as HTMLFormElement).requestSubmit();
        });
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await expect(field).toBeDisabled();
        await expect(page.locator('#catalogue-titleEn')).toBeDisabled();
        await dialog.getByRole('button', { name: t('team.confirm', locale), exact: true }).click();
        await expect(dialog).toBeHidden();
        expect(writes).toHaveLength(1);
        await expect(field).toBeFocused();
        await expect(field).toHaveValue(raw);
        await expect(page.getByText('PRIVATE_BACKEND_MESSAGE')).toHaveCount(0);
        phase = 'unknown';
        await form
          .getByRole('button', {
            name: label(kind === 'agreement' ? 'saveAgreement' : 'saveInventory'),
            exact: true,
          })
          .click();
        await expect(dialog).toBeVisible();
        await dialog.getByRole('button', { name: t('team.confirm', locale), exact: true }).click();
        await expect(dialog.getByRole('alert')).toBeVisible();
        await expect(dialog).toBeVisible();
        await dialog.getByRole('button', { name: t('team.cancel', locale), exact: true }).click();
        phase = 'mismatch';
        await form
          .getByRole('button', {
            name: label(kind === 'agreement' ? 'saveAgreement' : 'saveInventory'),
            exact: true,
          })
          .click();
        await dialog.getByRole('button', { name: t('team.confirm', locale), exact: true }).click();
        await expect(
          dialog.getByRole('button', { name: t('team.confirm', locale), exact: true })
        ).toBeDisabled();
        await expect(dialog).toContainText(label('unverifiedSaving'));
        await dialog.getByRole('button', { name: t('team.cancel', locale), exact: true }).click();
        await expect(field).toHaveValue(raw);
        const section = page.getByRole('region', {
          name: label(kind === 'agreement' ? 'agreement' : 'inventory'),
          exact: true,
        });
        await section.getByRole('button', { name: label('refresh'), exact: true }).click();
        await expect(field).toBeEnabled();
        await expect(field).toHaveValue(raw);
        phase = 'success';
        await form
          .getByRole('button', {
            name: label(kind === 'agreement' ? 'saveAgreement' : 'saveInventory'),
            exact: true,
          })
          .click();
        await dialog.getByRole('button', { name: t('team.confirm', locale), exact: true }).click();
        await dialog.locator('#team-step-up-password').fill('Test-only-password');
        await dialog.getByRole('button', { name: t('team.confirm', locale), exact: true }).click();
        await expect(dialog).toBeHidden();
        await expect(field).toHaveValue(kind === 'agreement' ? 'New saved terms' : '12');
        await expect(field).toBeDisabled();
        await expect(section).toContainText(
          label(kind === 'agreement' ? 'agreementLoadError' : 'inventoryLoadError')
        );
        expect(writes.at(-1)).toMatchObject(
          kind === 'agreement'
            ? { title: 'New saved terms', body: savingAgreement.body }
            : { stockTracking: true, stockCount: 12, reservationMinutes: 30 }
        );
        readFail = false;
        await section.getByRole('button', { name: label('retry'), exact: true }).click();
        await expect(field).toBeEnabled();
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
        ).toBe(true);
        if (locale === 'fa' && dark && testInfo.project.name === 'mobile-safari')
          await section.screenshot({
            path: `/tmp/barghsa-saving-${kind}-forms-fa-dark-mobile.png`,
          });
        phase = 'denied';
        await form
          .getByRole('button', {
            name: label(kind === 'agreement' ? 'saveAgreement' : 'saveInventory'),
            exact: true,
          })
          .click();
        await dialog.getByRole('button', { name: t('team.confirm', locale), exact: true }).click();
        await expect(form).toBeHidden();
        await expect(page.getByRole('alert')).toContainText(label('denied'));
      });

for (const kind of ['agreement', 'inventory'] as const) {
  test(`saving ${kind} delayed validation locks parent writes and discards a refreshed basis`, async ({
    page,
  }) => {
    await setupCatalogueForms(page, 'en', false);
    let changed = false;
    await reads(page, kind, () =>
      kind === 'agreement'
        ? {
            ...savingAgreementConfig,
            agreements: [
              { ...savingAgreement, title: changed ? 'Changed saved terms' : 'Saved terms' },
            ],
          }
        : { ...savingInventory, hardwareId: id, stockCount: changed ? 20 : 10 }
    );
    const manifest = JSON.parse(
      await readFile(new URL('../dist/.vite/manifest.json', import.meta.url), 'utf8')
    );
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/' + manifest['src/lib/catalogue-form-schemas.ts'].file, async (route) => {
      await pending;
      await route.continue();
    });
    const form = await open(page, kind, (key) => tCatalogue(key, 'en'));
    const field = page.locator(
      kind === 'agreement' ? '#saving-agreement-title' : '#saving-stock-count'
    );
    await field.fill(kind === 'agreement' ? ' ' : '1');
    await form
      .getByRole('button', {
        name: kind === 'agreement' ? 'Save agreement draft' : 'Save inventory settings',
        exact: true,
      })
      .click();
    await expect(field).toBeDisabled();
    await expect(page.locator('#catalogue-titleEn')).toBeDisabled();
    await form.evaluate((el) => {
      (el as HTMLFormElement).requestSubmit();
      (el as HTMLFormElement).requestSubmit();
    });
    await page
      .getByRole('form', { name: 'Product editor' })
      .evaluate((el) => (el as HTMLFormElement).requestSubmit());
    changed = true;
    await page.getByRole('button', { name: 'Refresh', exact: true }).first().click();
    await expect(field).toHaveValue(kind === 'agreement' ? 'Changed saved terms' : '20');
    release();
    await expect(field).toBeEnabled();
    await expect(field).not.toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
  test(`saving ${kind} unavailable validation retains raw drafts and releases controls`, async ({
    page,
  }) => {
    await setupCatalogueForms(page, 'fa', true);
    await reads(page, kind, () =>
      kind === 'agreement' ? savingAgreementConfig : { ...savingInventory, hardwareId: id }
    );
    const manifest = JSON.parse(
      await readFile(new URL('../dist/.vite/manifest.json', import.meta.url), 'utf8')
    );
    await page.route('**/' + manifest['src/lib/catalogue-form-schemas.ts'].file, (route) =>
      route.abort()
    );
    const label = (key: string) => tCatalogue(key, 'fa');
    const form = await open(page, kind, label);
    const field = page.locator(
      kind === 'agreement' ? '#saving-agreement-title' : '#saving-stock-count'
    );
    const raw = kind === 'agreement' ? ' پیش‌نویس محفوظ ' : ' ۱۲ ';
    await field.fill(raw);
    await form
      .getByRole('button', {
        name: label(kind === 'agreement' ? 'saveAgreement' : 'saveInventory'),
        exact: true,
      })
      .click();
    await expect(form.getByRole('alert')).toContainText(label('validationUnavailable'));
    await expect(field).toHaveValue(raw);
    await expect(field).toBeEnabled();
    await expect(page.locator('#catalogue-titleEn')).toBeEnabled();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
}
test('saving activation reviews the persisted draft, rejects an incorrect version and publishes matching immutable terms', async ({
  page,
}) => {
  await setupCatalogueForms(page, 'en', false);
  let config = {
    ...savingAgreementConfig,
    agreements: [
      {
        ...savingAgreement,
        status: 'draft' as 'draft' | 'active',
        effective_from: null as string | null,
      },
    ],
  };
  await reads(page, 'agreement', () => config);
  let valid = false;
  await page.route(
    `**/api/admin/catalogue/saving-plans/${id}/agreements/${savingAgreement.id}/activate`,
    (route) => {
      expect(route.request().postData()).toBeNull();
      const receipt = {
        ...savingAgreement,
        status: 'active' as const,
        effective_from: '2026-10-03T00:00:00Z',
        id: valid ? savingAgreement.id : hardwareId,
      };
      if (valid) config = { ...config, agreements: [receipt] };
      return route.fulfill({ status: 201, json: receipt });
    }
  );
  const form = await open(page, 'agreement', (key) => tCatalogue(key, 'en'));
  await page.locator('#saving-agreement-title').fill('Unsaved edits');
  await expect(
    page.getByRole('button', { name: 'Activate agreement', exact: true })
  ).toBeDisabled();
  await page.locator('#saving-agreement-title').fill(savingAgreement.title);
  await page.getByRole('button', { name: 'Activate agreement', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(savingAgreement.body);
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Confirm', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page
    .getByRole('region', { name: 'Plan agreement', exact: true })
    .getByRole('button', { name: 'Refresh', exact: true })
    .click();
  valid = true;
  await page.getByRole('button', { name: 'Activate agreement', exact: true }).click();
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(form).toBeVisible();
  await expect(
    page.getByText('Active agreement: ' + savingAgreement.title, { exact: true })
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Activate agreement', exact: true })).toHaveCount(
    0
  );
});
