import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import { t } from '@barghsa/i18n/app';
import { tSaving } from '@barghsa/i18n/saving';
import { tSavingHardware } from '@barghsa/i18n/saving-hardware';
import { tSavingStaffReview } from '@barghsa/i18n/saving-staff-review';
import { test, expect } from './coverage-fixture';
import {
  setupSavingHardwareForms,
  savingChangeOrder,
  otherSavingChangeOrder,
  currentHardware,
  replacementHardware,
  equalHardware,
  cheaperHardware,
  upgradeId,
  nextUpgradeId,
  chargeInvoiceId,
  creditInvoiceId,
  savingHardwareReview,
  savingHardwareCancellationReview,
} from './saving-hardware-form-fixture';
import { changeVersion } from './saving-change-address-form-fixture';
const receiptUuidPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const keyPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
async function focusedError(field: Locator) {
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(field).toHaveAttribute('aria-describedby', /-description.*-message/);
}
async function inspect(page: Page, region: Locator, selector: string, hover: Locator) {
  const focus = await page.evaluate(() => document.activeElement?.id);
  await hover.hover();
  expect(await page.evaluate(() => document.activeElement?.id)).toBe(focus);
  expect((await new AxeBuilder({ page }).include(selector).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const control of await region.locator('select,input,textarea,button').all()) {
    const box = await control.boundingBox();
    if (box) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
    }
  }
}
async function capture(region: Locator, path: string) {
  await region.scrollIntoViewIfNeeded();
  // Keep the compact fields below the real sticky app header, without changing any page styles.
  await region.evaluate((node) => window.scrollBy(0, node.getBoundingClientRect().top - 160));
  await region.screenshot({ path });
}
async function holdSchema(page: Page) {
  const manifest = JSON.parse(
    await readFile(new URL('../dist/.vite/manifest.json', import.meta.url), 'utf8')
  );
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    '**/' + manifest['src/lib/saving-hardware-form-schemas.ts'].file,
    async (route) => {
      await held;
      await route.continue();
    }
  );
  return release;
}
for (const [locale, theme] of [
  ['en', 'light'],
  ['fa', 'dark'],
] as const) {
  const copy = (key: string) => tSavingStaffReview(key, locale) ?? tSaving(key, locale);
  const formCopy = (key: string) => tSavingHardware(key, locale);
  const refresh = (page: Page) =>
    page.getByRole('button', { name: copy('staffRefresh'), exact: true }).first();
  const confirm = (page: Page) => page.getByRole('dialog').locator('button[type=submit]');
  const cancel = (page: Page) =>
    page.getByRole('dialog').getByRole('button', { name: t('team.cancel', locale), exact: true });
  test(`paid saving hardware charge and cancellation retain independent reasons and exact commands (${locale}, ${theme})`, async ({
    page,
  }, info) => {
    const { state, persistHardware, persistCancellation, nextPendingUpgrade } =
      await setupSavingHardwareForms(page, locale);
    const release = await holdSchema(page);
    await page.goto(`/admin/saving-orders?lane=fulfillment&orderId=${savingChangeOrder}`);
    const hardwareForm = page.getByTestId('saving-staff-hardware-form');
    const hardware = page.locator('#saving-amend-hardware');
    const reason = page.locator('#saving-amend-hardware-reason');
    const addressForm = page.getByTestId('saving-staff-address-form');
    const addressReason = page.locator('#saving-amend-reason');
    const note = page.locator('#saving-staff-note');
    const preview = () =>
      hardwareForm.getByRole('button', { name: copy('staffAmendHardware'), exact: true });
    await expect(hardwareForm).toBeVisible();
    await addressReason.fill('  Independent address explanation  ');
    await note.fill('  Independent public delivery note  ');
    await preview().click();
    await expect(hardwareForm.locator('button[type=submit]')).toBeDisabled();
    await hardwareForm.locator('form').dispatchEvent('submit');
    expect(state.hardwarePreviews).toEqual([]);
    release();
    await focusedError(reason);
    await reason.fill('  Higher-price device requested  ');
    await hardware.selectOption('');
    await preview().click();
    await focusedError(hardware);
    expect(state.hardwarePreviews).toEqual([]);
    await hardware.selectOption(replacementHardware);
    await reason.fill('x'.repeat(1001));
    await preview().click();
    await focusedError(reason);
    expect(state.hardwarePreviews).toEqual([]);
    await reason.fill('  Higher-price device requested  ');
    await preview().click();
    await focusedError(reason);
    await expect(hardware).toHaveValue(replacementHardware);
    await expect(reason).toHaveValue('  Higher-price device requested  ');
    expect(state.hardwarePreviews[0]).toEqual({
      expectedVersionId: changeVersion,
      expectedHardwareId: currentHardware,
      hardwareProductId: replacementHardware,
      reason: 'Higher-price device requested',
    });
    await expect(hardwareForm).not.toContainText('PRIVATE_HARDWARE_SERVER_MESSAGE');
    await inspect(page, hardwareForm, '[data-testid="saving-staff-hardware-form"]', preview());
    await capture(hardwareForm, info.outputPath(`saving-hardware-fields-${locale}-${theme}.png`));
    state.hardwarePreviewMode = 'foreign';
    await preview().click();
    await expect(hardwareForm.getByRole('alert')).toContainText(copy('staffReviewError'));
    await expect(page.getByRole('dialog')).toHaveCount(0);
    state.hardwarePreviewMode = 'success';
    await preview().click();
    let dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(copy('staffHardwareOutcome.additional_charge'));
    await expect(dialog).toContainText(copy('staffHardwareTargetTotal'));
    await expect(dialog).toContainText(copy('staffReviewContractVersion'));
    await inspect(page, dialog, '[role="dialog"]', confirm(page));
    state.hardwareWriteMode = 'held';
    state.needsStepUp = true;
    await confirm(page).click();
    await dialog
      .getByLabel(t('team.password', locale), { exact: true })
      .fill('Saving-form-proof-42!');
    await confirm(page).click();
    await expect.poll(() => !!state.hardwareWriteRoute).toBe(true);
    expect(state.stepUp.requests).toEqual([{ password: 'Saving-form-proof-42!' }]);
    const hardwareCommand = state.hardwareWrites.at(-1)!,
      hardwareBody = state.hardwareBodies.at(-1)!;
    const reviewed = savingHardwareReview(
      state.details.get(savingChangeOrder)!,
      state.hardwarePreviews.at(-1)!
    );
    expect(hardwareCommand).toEqual({
      ...state.hardwarePreviews.at(-1),
      expectedReviewHash: reviewed.hash,
      idempotencyKey: expect.stringMatching(keyPattern),
    });
    expect(state.hardwareWrites).toEqual([hardwareCommand, hardwareCommand]);
    expect(state.hardwareCsrf[1]).toBe('rotated-saving-password-proof');
    await dialog.locator('form').dispatchEvent('submit');
    expect(state.hardwareWrites).toHaveLength(2);
    const pending = persistHardware(hardwareCommand);
    expect(pending).toEqual({
      upgradeId,
      savingOrderId: savingChangeOrder,
      hardwareProductId: replacementHardware,
      priceDeltaIrR: '54500',
      adjustmentInvoiceId: chargeInvoiceId,
      status: 'awaiting_payment',
    });
    await state.hardwareWriteRoute!.fulfill({
      status: 201,
      json: { ...pending, savingOrderId: otherSavingChangeOrder },
    });
    await expect(dialog).toHaveCount(0);
    const hardwareRetry = page.getByTestId('saving-staff-hardware-retry');
    await expect(hardwareRetry).toHaveText(formCopy('retryCaptured'));
    await expect(
      addressForm.getByRole('button', { name: copy('staffAmendAddress'), exact: true })
    ).toBeDisabled();
    await expect(hardware).toBeDisabled();
    const readCount = state.reads.length;
    await hardwareForm.locator('form').dispatchEvent('submit');
    await addressForm.locator('form').dispatchEvent('submit');
    await refresh(page).dispatchEvent('click');
    expect(state.reads).toHaveLength(readCount);
    expect(state.hardwareWrites).toHaveLength(2);
    state.hardwareWriteMode = 'rejected';
    await hardwareRetry.click();
    await confirm(page).click();
    await cancel(page).click();
    await expect(hardwareRetry).toBeEnabled();
    await expect(hardware).toBeDisabled();
    state.hardwareWriteMode = 'success';
    await hardwareRetry.click();
    await confirm(page).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(hardwareRetry).toHaveCount(0);
    expect(state.hardwareWrites).toEqual(Array.from({ length: 4 }, () => hardwareCommand));
    expect(state.hardwareBodies).toEqual(Array.from({ length: 4 }, () => hardwareBody));
    expect(state.hardwareCsrf.slice(1)).toEqual(
      Array.from({ length: 3 }, () => 'rotated-saving-password-proof')
    );
    await expect(addressReason).toHaveValue('  Independent address explanation  ');
    await expect(note).toHaveValue('  Independent public delivery note  ');
    const row = page.getByTestId(`saving-upgrade-cancel-form-${upgradeId}`);
    const rowReason = page.locator(`#saving-upgrade-cancel-${upgradeId}`);
    const rowSubmit = () =>
      row.getByRole('button', { name: copy('hardwareUpgradeCancel'), exact: true });
    await expect(rowReason).toHaveValue('');
    await rowSubmit().click();
    await focusedError(rowReason);
    await rowReason.fill('x'.repeat(1001));
    await rowSubmit().click();
    await focusedError(rowReason);
    expect(state.cancelPreviews).toEqual([]);
    await rowReason.fill('  Customer declined unpaid charge  ');
    await rowSubmit().click();
    await focusedError(rowReason);
    expect(state.cancelPreviews[0]).toEqual({
      upgradeId,
      reason: 'Customer declined unpaid charge',
    });
    await expect(rowReason).toHaveValue('  Customer declined unpaid charge  ');
    await inspect(
      page,
      row,
      `[data-testid="saving-upgrade-cancel-form-${upgradeId}"]`,
      rowSubmit()
    );
    await capture(row, info.outputPath(`saving-upgrade-cancel-fields-${locale}-${theme}.png`));
    state.cancelPreviewMode = 'malformed';
    await rowSubmit().click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(row.getByRole('alert')).toContainText(copy('staffReviewError'));
    state.cancelPreviewMode = 'success';
    await rowSubmit().click();
    dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(copy('staffUpgradeCancellationRelease'));
    await expect(dialog).toContainText(copy('staffUpgradeCancellationOutcome'));
    await inspect(page, dialog, '[role="dialog"]', confirm(page));
    state.cancelWriteMode = 'held';
    await confirm(page).click();
    await expect.poll(() => !!state.cancelWriteRoute).toBe(true);
    const command = state.cancelWrites.at(-1)!,
      body = state.cancelBodies.at(-1)!;
    expect(command).toEqual({
      upgradeId,
      reason: 'Customer declined unpaid charge',
      expectedReviewHash: savingHardwareCancellationReview(
        state.details.get(savingChangeOrder)!,
        state.cancelPreviews.at(-1)!
      ).hash,
      idempotencyKey: expect.stringMatching(keyPattern),
    });
    persistCancellation(command);
    await state.cancelWriteRoute!.fulfill({ status: 503, json: {} });
    await expect(dialog).toHaveCount(0);
    const retry = page.getByTestId(`saving-upgrade-cancel-retry-${upgradeId}`);
    await expect(retry).toHaveText(formCopy('retryCancellation'));
    await expect(rowReason).toBeDisabled();
    await expect(
      addressForm.getByRole('button', { name: copy('staffAmendAddress'), exact: true })
    ).toBeDisabled();
    const reads = state.reads.length;
    await row.locator('form').dispatchEvent('submit');
    await refresh(page).dispatchEvent('click');
    expect(state.reads).toHaveLength(reads);
    expect(state.cancelWrites).toHaveLength(1);
    state.cancelWriteMode = 'rejected';
    await retry.click();
    await confirm(page).click();
    await cancel(page).click();
    await expect(retry).toBeEnabled();
    await expect(rowReason).toHaveValue('  Customer declined unpaid charge  ');
    state.cancelWriteMode = 'success';
    await retry.click();
    await confirm(page).click();
    await expect(retry).toHaveCount(0);
    await expect(row).toHaveCount(0);
    expect(state.cancelWrites).toEqual(Array.from({ length: 3 }, () => command));
    expect(state.cancelBodies).toEqual(Array.from({ length: 3 }, () => body));
    await expect(addressReason).toHaveValue('  Independent address explanation  ');
    await expect(note).toHaveValue('  Independent public delivery note  ');
    nextPendingUpgrade();
    await refresh(page).click();
    const nextRow = page.getByTestId(`saving-upgrade-cancel-form-${nextUpgradeId}`),
      nextReason = page.locator(`#saving-upgrade-cancel-${nextUpgradeId}`);
    await expect(nextReason).toHaveValue('');
    await expect(page.locator(`#saving-upgrade-cancel-${upgradeId}`)).toHaveCount(0);
    await nextReason.fill('Fresh row private reason');
    state.cancelPreviewMode = locale === 'en' ? 'missing' : 'denied';
    await nextRow.getByRole('button', { name: copy('hardwareUpgradeCancel'), exact: true }).click();
    await expect(nextRow).toHaveCount(0);
    await expect(page.locator('#saving-amend-reason')).toHaveCount(0);
    await expect(page.getByRole('main')).not.toContainText('PRIVATE_HARDWARE_SERVER_MESSAGE');
  });
  test(`saving immediate hardware ${locale === 'en' ? 'same-price' : 'credit'} swap retains exact receipt and source privacy (${locale}, ${theme})`, async ({
    page,
  }, info) => {
    const { state, persistHardware } = await setupSavingHardwareForms(page, locale);
    const release = await holdSchema(page),
      target = locale === 'en' ? equalHardware : cheaperHardware;
    await page.goto(`/admin/saving-orders?lane=fulfillment&orderId=${savingChangeOrder}`);
    const form = page.getByTestId('saving-staff-hardware-form'),
      hardware = page.locator('#saving-amend-hardware'),
      reason = page.locator('#saving-amend-hardware-reason');
    const preview = () =>
      form.getByRole('button', { name: copy('staffAmendHardware'), exact: true });
    const addressReason = page.locator('#saving-amend-reason'),
      note = page.locator('#saving-staff-note');
    await expect(form).toBeVisible();
    await hardware.selectOption(target);
    await addressReason.fill('  Independent address draft  ');
    await note.fill('  Independent progress note  ');
    await preview().click();
    await expect(form.locator('button[type=submit]')).toBeDisabled();
    await form.locator('form').dispatchEvent('submit');
    expect(state.hardwarePreviews).toEqual([]);
    release();
    await focusedError(reason);
    await reason.fill('  Customer chose immediate replacement  ');
    await preview().click();
    await focusedError(reason);
    await expect(hardware).toHaveValue(target);
    await expect(reason).toHaveValue('  Customer chose immediate replacement  ');
    await inspect(page, form, '[data-testid="saving-staff-hardware-form"]', preview());
    await capture(form, info.outputPath(`saving-immediate-hardware-fields-${locale}-${theme}.png`));
    state.hardwarePreviewMode = 'malformed';
    await preview().click();
    await expect(form.getByRole('alert')).toContainText(copy('staffReviewError'));
    await expect(page.getByRole('dialog')).toHaveCount(0);
    state.hardwarePreviewMode = 'success';
    await preview().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(
      copy(
        locale === 'en'
          ? 'staffHardwareOutcome.swap_without_price_change'
          : 'staffHardwareOutcome.credit_note'
      )
    );
    state.hardwareWriteMode = 'held';
    await confirm(page).click();
    await expect.poll(() => !!state.hardwareWriteRoute).toBe(true);
    const command = state.hardwareWrites[0]!,
      body = state.hardwareBodies[0]!;
    expect(command).toEqual({
      expectedVersionId: changeVersion,
      expectedHardwareId: currentHardware,
      hardwareProductId: target,
      reason: 'Customer chose immediate replacement',
      expectedReviewHash: savingHardwareReview(
        state.details.get(savingChangeOrder)!,
        state.hardwarePreviews.at(-1)!
      ).hash,
      idempotencyKey: expect.stringMatching(keyPattern),
    });
    const receipt = persistHardware(command);
    expect(receipt).toEqual({
      amendmentId: expect.stringMatching(receiptUuidPattern),
      savingOrderId: savingChangeOrder,
      hardwareProductId: target,
      priceDeltaIrR: locale === 'en' ? '0' : '-54500',
      adjustmentInvoiceId: locale === 'en' ? null : creditInvoiceId,
    });
    await state.hardwareWriteRoute!.fulfill({
      status: 201,
      json: { ...receipt, adjustmentInvoiceId: locale === 'en' ? creditInvoiceId : null },
    });
    await expect(dialog).toHaveCount(0);
    const retry = page.getByTestId('saving-staff-hardware-retry');
    await expect(retry).toBeEnabled();
    await expect(hardware).toBeDisabled();
    const reads = state.reads.length;
    await form.locator('form').dispatchEvent('submit');
    await refresh(page).dispatchEvent('click');
    expect(state.reads).toHaveLength(reads);
    expect(state.hardwareWrites).toHaveLength(1);
    state.hardwareWriteMode = 'malformed';
    await retry.click();
    await confirm(page).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(retry).toBeEnabled();
    await expect(hardware).toBeDisabled();
    state.hardwareWriteMode = 'rejected';
    await retry.click();
    await confirm(page).click();
    await cancel(page).click();
    await expect(retry).toBeEnabled();
    await expect(reason).toHaveValue('  Customer chose immediate replacement  ');
    state.hardwareWriteMode = 'success';
    await retry.click();
    await confirm(page).click();
    await expect(retry).toHaveCount(0);
    await expect(reason).toHaveValue('');
    expect(state.hardwareWrites).toEqual(Array.from({ length: 4 }, () => command));
    expect(state.hardwareBodies).toEqual(Array.from({ length: 4 }, () => body));
    await expect(addressReason).toHaveValue('  Independent address draft  ');
    await expect(note).toHaveValue('  Independent progress note  ');
    const history = page
      .getByRole('heading', { name: copy('hardwareAmendments'), exact: true })
      .locator('..');
    await expect(history).toContainText(
      copy(locale === 'en' ? 'hardwareNoPriceChange' : 'hardwareCreditIssued')
    );
    await expect(history.getByRole('link', { name: copy('invoice'), exact: true })).toHaveCount(
      locale === 'en' ? 0 : 1
    );
    if (locale === 'fa')
      await expect(
        history.getByRole('link', { name: copy('invoice'), exact: true })
      ).toHaveAttribute('href', `/invoices/${creditInvoiceId}`);
    await capture(
      history,
      info.outputPath(`saving-immediate-hardware-result-${locale}-${theme}.png`)
    );
    await hardware.selectOption(replacementHardware);
    await reason.fill('Old source private replacement');
    state.hardwarePreviewMode = 'held';
    await preview().click();
    await expect.poll(() => !!state.hardwarePreviewRoute).toBe(true);
    const stale = state.hardwarePreviewRoute!;
    // Browser back/forward query selection can change scope even while command-owned controls are disabled.
    await page.evaluate((id) => {
      const url = new URL(location.href);
      url.searchParams.set('orderId', id);
      window.history.pushState({}, '', url.href);
      dispatchEvent(new PopStateEvent('popstate'));
    }, otherSavingChangeOrder);
    await expect(reason).toHaveValue('');
    await stale
      .fulfill({
        status: 403,
        json: {
          error: {
            code: 'AUTHZ:FORBIDDEN',
            message: 'OBSOLETE_HARDWARE_DENIAL',
            correlationId: '89300000-0000-4000-8000-000000000008',
          },
        },
      })
      .catch(() => {});
    await expect(form).toBeVisible();
    await expect(form.getByRole('alert')).toHaveCount(0);
    await expect(reason).toHaveValue('');
    await expect(page.getByRole('main')).not.toContainText('OBSOLETE_HARDWARE_DENIAL');
    state.hardwarePreviewMode = 'success';
    await reason.fill('Fresh authorized replacement');
    await preview().click();
    await expect(page.getByRole('dialog')).toContainText('Other Change Buyer');
    await cancel(page).click();
  });
}
