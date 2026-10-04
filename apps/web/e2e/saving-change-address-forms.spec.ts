import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import { t } from '@barghsa/i18n/app';
import { tSaving } from '@barghsa/i18n/saving';
import { tSavingStaffReview } from '@barghsa/i18n/saving-staff-review';
import { tSavingChange } from '@barghsa/i18n/saving-change';
import { test, expect } from './coverage-fixture';
import {
  setupSavingChangeAddressForms,
  savingChangeOrder,
  otherSavingChangeOrder,
  currentHardware,
  replacementHardware,
  unavailableHardware,
  currentAddress,
  replacementAddress,
  changeVersion,
  changedVersion,
  changeInvoice,
  savingChangeQuote,
  savingAddressReview,
} from './saving-change-address-form-fixture';

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
  for (const field of await region.locator('input,select,textarea,button').all()) {
    const box = await field.boundingBox();
    if (box) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
    }
  }
}
async function holdSchema(page: Page, module: string) {
  const manifest = JSON.parse(
    await readFile(new URL('../dist/.vite/manifest.json', import.meta.url), 'utf8')
  );
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/' + manifest[`src/lib/${module}.ts`].file, async (route) => {
    await held;
    await route.continue();
  });
  return release;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
for (const [locale, theme] of [
  ['en', 'light'],
  ['fa', 'dark'],
] as const) {
  const copy = (key: string) => tSavingStaffReview(key, locale) ?? tSaving(key, locale);
  const formCopy = (key: string) => tSavingChange(key, locale);
  test(`customer saving changes retain reviewed selections and exact revision recovery (${locale}, ${theme})`, async ({
    page,
  }, info) => {
    const { state, persistCustomer } = await setupSavingChangeAddressForms(page, locale, false);
    const release = await holdSchema(page, 'saving-change-form-schemas');
    await page.goto(`/savings/orders/${savingChangeOrder}`);
    const panel = page.getByTestId('saving-change-panel');
    const form = panel.getByTestId('saving-change-form');
    const hardware = page.locator('#saving-change-hardware');
    const address = page.locator('#saving-change-address');
    const preview = () => form.getByRole('button', { name: copy('previewChange'), exact: true });
    await expect(hardware).toHaveValue(currentHardware);
    await expect(address).toHaveValue(currentAddress);
    await expect(hardware.locator(`option[value="${unavailableHardware}"]`)).toBeDisabled();
    await preview().click();
    await expect(form.locator('button[type=submit]')).toBeDisabled();
    await form.dispatchEvent('submit');
    expect(state.customerQuotes).toEqual([]);
    release();
    await focusedError(hardware);
    await expect(panel).toContainText(formCopy('customerUnchanged'));
    await hardware.selectOption(replacementHardware);
    await address.selectOption(replacementAddress);
    await preview().click();
    await focusedError(address);
    await expect(hardware).toHaveValue(replacementHardware);
    await expect(address).toHaveValue(replacementAddress);
    expect(state.customerQuotes[0]).toEqual({
      hardwareProductId: replacementHardware,
      installationAddressId: replacementAddress,
    });
    await expect(panel).not.toContainText('PRIVATE_CHANGE_SERVER_MESSAGE');
    await inspect(page, panel, '[data-testid="saving-change-panel"]', preview());
    await form.screenshot({ path: info.outputPath(`saving-change-fields-${locale}-${theme}.png`) });
    state.customerQuoteMode = locale === 'en' ? 'malformed' : 'foreign';
    await preview().click();
    await expect(panel.getByRole('alert')).toContainText(copy('quoteError'));
    await expect(panel.getByTestId('saving-change-quote')).toHaveCount(0);
    await expect(hardware).toHaveValue(replacementHardware);
    await expect(address).toHaveValue(replacementAddress);
    state.customerQuoteMode = 'success';
    await preview().click();
    const quote = panel.getByTestId('saving-change-quote');
    await expect(quote).toContainText('Replacement installation address');
    await expect(quote).toContainText(copy('retainedDiscount'));
    const confirm = panel.getByRole('button', { name: copy('confirmChange'), exact: true });
    await inspect(page, panel, '[data-testid="saving-change-panel"]', confirm);
    await quote.screenshot({ path: info.outputPath(`saving-change-quote-${locale}-${theme}.png`) });
    state.customerWriteMode = 'held';
    await confirm.click();
    await expect.poll(() => !!state.customerWriteRoute).toBe(true);
    const captured = state.customerWrites.at(-1)!;
    const serialized = state.customerSerializedWrites.at(-1)!;
    expect(captured).toEqual({
      hardwareProductId: replacementHardware,
      installationAddressId: replacementAddress,
      expectedQuoteDigest: savingChangeQuote().reviewDigest,
      idempotencyKey: expect.stringMatching(uuid),
    });
    await form.dispatchEvent('submit');
    expect(state.customerWrites).toHaveLength(1);
    const receipt = persistCustomer(captured);
    expect(receipt.contractVersionId).toBe(changedVersion);
    expect(receipt.invoiceId).toBe(changeInvoice);
    await state.customerWriteRoute!.fulfill({ status: 503, json: {} });
    const retry = panel.getByTestId('saving-change-retry');
    await expect(retry).toHaveText(formCopy('customerRetryCaptured'));
    await expect(hardware).toBeDisabled();
    await expect(address).toBeDisabled();
    await expect(
      panel.getByRole('link', { name: copy('manageAddresses'), exact: true })
    ).toHaveCount(0);
    const reads = state.reads.length,
      previews = state.customerQuotes.length;
    await form.dispatchEvent('submit');
    expect(state.reads).toHaveLength(reads);
    expect(state.customerQuotes).toHaveLength(previews);
    state.customerWriteMode = 'rejected';
    let retryResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/saving/orders/${savingChangeOrder}/change`
    );
    await retry.click();
    await retryResponse;
    await expect(retry).toBeEnabled();
    await expect(hardware).toBeDisabled();
    expect(state.customerWrites.at(-1)).toEqual(captured);
    state.customerWriteMode = locale === 'en' ? 'foreign' : 'malformed';
    retryResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/saving/orders/${savingChangeOrder}/change`
    );
    await retry.click();
    await retryResponse;
    await expect(retry).toBeEnabled();
    await expect(address).toBeDisabled();
    await expect(panel).toContainText(formCopy('customerUncertain'));
    state.customerWriteMode = 'success';
    await retry.click();
    await expect(panel.getByTestId('saving-change-retry')).toHaveCount(0);
    await expect(panel.getByTestId('saving-change-quote')).toHaveCount(0);
    await expect(hardware).toBeEnabled();
    await expect(hardware).toHaveValue(replacementHardware);
    await expect(address).toHaveValue(replacementAddress);
    expect(state.customerWrites).toEqual(Array.from({ length: 4 }, () => captured));
    expect(state.customerSerializedWrites).toEqual(Array.from({ length: 4 }, () => serialized));
    // Current access loss withdraws the accepted parent detail and its private change workspace.
    await hardware.selectOption(currentHardware);
    await address.selectOption(currentAddress);
    state.customerQuoteMode = locale === 'en' ? 'denied' : 'missing';
    await preview().click();
    await expect(panel).toHaveCount(0);
    await expect(page.getByRole('main').getByRole('alert')).toContainText(copy('error'));
    await expect(page.locator('#saving-change-hardware,#saving-change-address')).toHaveCount(0);
    await expect(page.getByTestId('saving-change-quote')).toHaveCount(0);
    await expect(
      page.getByRole('main').getByRole('button', { name: copy('retry'), exact: true })
    ).toBeEnabled();
  });
  test(`staff saving address amendments preserve independent drafts and exact captured command (${locale}, ${theme})`, async ({
    page,
  }, info) => {
    const { state, persistStaff } = await setupSavingChangeAddressForms(page, locale, true);
    const release = await holdSchema(page, 'saving-address-amendment-form-schemas');
    await page.goto(`/admin/saving-orders?lane=fulfillment&orderId=${savingChangeOrder}`);
    let region = page.getByTestId('saving-staff-address-form');
    let form = region.locator('form');
    let address = page.locator('#saving-amend-address');
    let reason = page.locator('#saving-amend-reason');
    const preview = () =>
      form.getByRole('button', { name: copy('staffAmendAddress'), exact: true });
    const hardwareReason = page.locator('#saving-amend-hardware-reason');
    const note = page.locator('#saving-staff-note');
    await expect(region).toBeVisible();
    await hardwareReason.fill('  Independent device draft  ');
    await note.fill('  Independent public progress draft  ');
    await preview().click();
    await expect(form.locator('button[type=submit]')).toBeDisabled();
    await form.dispatchEvent('submit');
    expect(state.staffReviews).toEqual([]);
    release();
    await focusedError(address);
    await address.selectOption(replacementAddress);
    await reason.fill('x'.repeat(1001));
    await preview().click();
    await focusedError(reason);
    expect(state.staffReviews).toEqual([]);
    await reason.fill('  Customer confirmed replacement  ');
    await preview().click();
    await focusedError(reason);
    await expect(address).toHaveValue(replacementAddress);
    await expect(reason).toHaveValue('  Customer confirmed replacement  ');
    expect(state.staffReviews[0]).toEqual({
      expectedVersionId: changeVersion,
      expectedAddressId: currentAddress,
      addressId: replacementAddress,
      reason: 'Customer confirmed replacement',
    });
    await expect(region).not.toContainText('PRIVATE_CHANGE_SERVER_MESSAGE');
    await inspect(page, region, '[data-testid="saving-staff-address-form"]', preview());
    await form.screenshot({
      path: info.outputPath(`saving-address-fields-${locale}-${theme}.png`),
    });
    state.staffReviewMode = locale === 'en' ? 'foreign' : 'malformed';
    await preview().click();
    await expect(region.getByRole('alert')).toContainText(copy('staffReviewError'));
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(reason).toHaveValue('  Customer confirmed replacement  ');
    state.staffReviewMode = 'success';
    await preview().click();
    let dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(copy('staffAddressReviewReplacement'));
    await expect(dialog).toContainText('Replacement installation address');
    await expect(dialog).toContainText(copy('staffAddressReviewOutcome'));
    state.staffWriteMode = 'held';
    state.needsStepUp = true;
    await dialog.locator('button[type=submit]').click();
    await dialog
      .getByLabel(t('team.password', locale), { exact: true })
      .fill('Saving-form-proof-42!');
    await dialog.locator('button[type=submit]').click();
    await expect.poll(() => !!state.staffWriteRoute).toBe(true);
    expect(state.stepUp.requests).toEqual([{ password: 'Saving-form-proof-42!' }]);
    const captured = state.staffWrites.at(-1)!;
    const serialized = state.staffSerializedWrites.at(-1)!;
    const reviewed = savingAddressReview(
      state.staffDetails.get(savingChangeOrder)!,
      state.staffReviews.at(-1)!
    );
    expect(captured).toEqual({
      ...state.staffReviews.at(-1),
      expectedReviewHash: reviewed.hash,
      idempotencyKey: expect.stringMatching(uuid),
    });
    expect(state.staffWrites.slice(-2)).toEqual([captured, captured]);
    await dialog.locator('form').dispatchEvent('submit');
    expect(state.staffWrites).toHaveLength(2);
    const receipt = persistStaff(captured);
    await state.staffWriteRoute!.fulfill({
      status: 201,
      json: { ...receipt, savingOrderId: otherSavingChangeOrder },
    });
    await expect(dialog).toHaveCount(0);
    const retry = region.getByTestId('saving-staff-address-retry');
    await expect(retry).toHaveText(formCopy('staffRetryCaptured'));
    await expect(address).toBeDisabled();
    await expect(reason).toHaveValue('  Customer confirmed replacement  ');
    const refresh = page.getByRole('button', { name: copy('staffRefresh'), exact: true }).first();
    await expect(refresh).toBeDisabled();
    const writes = state.staffWrites.length,
      reads = state.reads.length;
    await form.dispatchEvent('submit');
    await refresh.dispatchEvent('click');
    expect(state.staffWrites).toHaveLength(writes);
    expect(state.reads).toHaveLength(reads);
    state.staffWriteMode = 'rejected';
    await retry.click();
    dialog = page.getByRole('dialog');
    await dialog.locator('button[type=submit]').click();
    await dialog.getByRole('button', { name: t('team.cancel', locale), exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(retry).toBeEnabled();
    await expect(address).toBeDisabled();
    state.staffWriteMode = 'success';
    await retry.click();
    dialog = page.getByRole('dialog');
    await dialog.locator('button[type=submit]').click();
    await expect(dialog).toHaveCount(0);
    await expect(region.getByTestId('saving-staff-address-retry')).toHaveCount(0);
    await expect(reason).toHaveValue('');
    await expect(hardwareReason).toHaveValue('  Independent device draft  ');
    await expect(note).toHaveValue('  Independent public progress draft  ');
    expect(state.staffWrites).toEqual(Array.from({ length: 4 }, () => captured));
    expect(state.staffSerializedWrites).toEqual(Array.from({ length: 4 }, () => serialized));
    await inspect(page, region, '[data-testid="saving-staff-address-form"]', preview());
    await form.screenshot({
      path: info.outputPath(`saving-address-cleared-${locale}-${theme}.png`),
    });
    // Read-only prepared work can be abandoned safely by selecting a different authorized order.
    await address.selectOption(currentAddress);
    await reason.fill('  Scoped private address draft  ');
    state.staffReviewMode = 'held';
    await preview().click();
    await expect.poll(() => !!state.staffReviewRoute).toBe(true);
    const stale = state.staffReviewRoute!;
    await page.getByRole('button', { name: /Other Change Buyer/ }).click();
    region = page.getByTestId('saving-staff-address-form');
    form = region.locator('form');
    address = page.locator('#saving-amend-address');
    reason = page.locator('#saving-amend-reason');
    await expect(reason).toHaveValue('');
    await stale
      .fulfill({
        status: 403,
        json: {
          error: {
            code: 'AUTHZ:FORBIDDEN',
            message: 'OBSOLETE_PRIVATE_ADDRESS_DENIAL',
            correlationId: '89200000-0000-4000-8000-000000000018',
          },
        },
      })
      .catch(() => {});
    await expect(region).toBeVisible();
    await expect(region.getByRole('alert')).toHaveCount(0);
    await expect(region).not.toContainText('Scoped private address draft');
    await expect(region).not.toContainText('OBSOLETE_PRIVATE_ADDRESS_DENIAL');
  });
}
