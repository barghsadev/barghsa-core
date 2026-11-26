import { approveRiskConfirmation } from './confirmation-fixture';
import { productionManifest } from './production-manifest';
import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page, Route } from '@playwright/test';
import { t } from '@barghsa/i18n/app';
import { adminText, t as priceFormText } from '@barghsa/i18n/electricity-price-forms';
import { test, expect } from './coverage-fixture';
import { fullNavigation } from './navigation-fixture';
import {
  creditAdjustmentId,
  cancelledAdjustmentId,
  contractId,
  versionId,
  orderId,
  linkedCreditId,
  defaultPriceInput,
  priceRow,
  priceReview,
  finalizedPrice,
  cancelledPrice,
  setupElectricityPriceAdjustmentForms,
} from './electricity-price-adjustment-form-fixture';

test('staff can open a price adjustment history from the filtered contracts list', async ({
  page,
}) => {
  const state = await setupElectricityPriceAdjustmentForms(page, 'en', false);
  state.auth.context = 'staff';
  const lookup = '/admin/electricity-price-adjustments';
  const types: (string | null)[] = [];
  await page.route('**/api/admin/contracts?*', (route) => {
    types.push(new URL(route.request().url()).searchParams.get('serviceType'));
    return route.fulfill({
      json: {
        contracts: [
          {
            id: contractId,
            contractNumber: '120482',
            serviceType: 'electricity',
            state: 'Active',
            versionId,
            versionNumber: 1,
          },
        ],
        nextBefore: null,
      },
    });
  });
  await page.goto(lookup);
  const browse = page.getByRole('link', {
    name: priceFormText('electricity.priceForm.browseContracts', 'en'),
    exact: true,
  });
  await browse.click();
  await expect(page).toHaveURL('/admin/contracts?serviceType=electricity');
  const history = page.locator(`main a[href="${lookup}/${contractId}"]:visible`);
  await expect(history).toHaveCount(1);
  expect(types).toEqual(['electricity']);
  await history.click();
  await expect(page).toHaveURL(`${lookup}/${contractId}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    adminText('admin.electricityPrice.contractHistory', 'en')
  );
  expect(state.writes).toEqual([]);

  const navigation = fullNavigation('staff');
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({
      json: {
        userId: 'price-reviewer',
        isStaff: true,
        operatingContext: 'staff',
        canSwitchContext: false,
        requiresTosAcceptance: false,
        navigation: {
          ...navigation,
          paths: navigation.paths.filter((path) => path !== '/admin/contracts'),
        },
      },
    })
  );
  await page.goto(lookup);
  const picker = page.locator('#electricity-price-contract');
  await expect(browse).toHaveCount(0);
  await picker.fill(contractId);
  await picker.press('Enter');
  await expect(page).toHaveURL(`${lookup}/${contractId}`);
  expect(types).toEqual(['electricity']);
  expect(state.writes).toEqual([]);
});

async function focusedError(field: Locator) {
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(field).toHaveAttribute('aria-describedby', /-description.*-message/);
}
async function inspect(page: Page, region: Locator, testId: string) {
  expect(
    (await new AxeBuilder({ page }).include(`[data-testid="${testId}"]`).analyze()).violations
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const control of await region.locator('input,textarea,button,summary').all()) {
    const box = await control.boundingBox();
    if (box) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
    }
  }
}
for (const [locale, theme] of [
  ['en', 'light'],
  ['fa', 'dark'],
] as const) {
  const copy = (key: string) => adminText(`admin.electricityPrice.${key}`, locale);
  const app = (key: string) => t(key, locale);
  test(`staff price picker and proposal preserve exact financial actions (${locale}, ${theme})`, async ({
    page,
  }, info) => {
    const state = await setupElectricityPriceAdjustmentForms(page, locale, theme === 'dark');
    state.auth.context = 'staff';
    const manifest = await productionManifest();
    let releaseSchema!: () => void;
    const schemaHeld = new Promise<void>((resolve) => {
      releaseSchema = resolve;
    });
    await page.route(
      '**/' + manifest['src/lib/electricity-price-form-schemas.ts'].file,
      async (route) => {
        await schemaHeld;
        await route.continue();
      }
    );
    await page.goto('/admin/electricity-price-adjustments');
    const pickerForm = page.getByTestId('electricity-price-contract-form');
    const picker = page.locator('#electricity-price-contract');
    const open = pickerForm.getByRole('button', { name: copy('open'), exact: true });
    await expect(picker).toHaveAttribute('aria-required', 'true');
    await expect(picker).not.toHaveAttribute('aria-invalid', 'true');
    await open.click();
    await expect(open).toBeDisabled();
    await pickerForm.dispatchEvent('submit');
    expect(state.staffReads).toBe(0);
    releaseSchema();
    await focusedError(picker);
    await picker.fill('INVALID_CONTRACT');
    await open.click();
    await focusedError(picker);
    expect(state.staffReads).toBe(0);
    await inspect(page, pickerForm, 'electricity-price-contract-form');
    await picker
      .locator('..')
      .screenshot({ path: info.outputPath(`price-picker-${locale}-${theme}.png`) });
    await picker.fill(` ${contractId} `);
    await picker.press('Enter');
    await page.getByRole('link', { name: copy('newProposal'), exact: true }).click();
    const form = page.getByTestId('electricity-price-proposal-form');
    await expect(form).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/${contractId}/new$`));
    expect(state.staffReads).toBe(2);
    const percentage = page.locator('#price-percent');
    const date = page.locator('#price-effective');
    const reason = page.locator('#price-reason');
    const basis = page.locator('#price-basis');
    const review = form.getByRole('button', { name: copy('reviewProposal'), exact: true });
    await expect(review).toBeInViewport({ ratio: 0.99 });
    for (const field of [percentage, date, reason, basis])
      await expect(field).toHaveAttribute('aria-required', 'true');
    await percentage.fill('0');
    await date.fill('2026-10-09T12:00');
    const draftReason = 'Draft <script> tariff\nApplies to the remaining delivery period.';
    await reason.fill(`  ${draftReason}  `);
    await basis.fill('  Contract clause 7  ');
    await review.click();
    await focusedError(percentage);
    expect(state.previews).toEqual([]);
    await percentage.fill(' 10.25 ');
    await review.click();
    await focusedError(reason);
    await expect(percentage).toHaveValue(' 10.25 ');
    await expect(date).toHaveValue('2026-10-09T12:00');
    await expect(reason).toHaveValue(`  ${draftReason}  `);
    await expect(basis).toHaveValue('  Contract clause 7  ');
    const effectiveFrom = '2026-10-09T08:30:00.000Z';
    expect(state.previews[0]).toEqual({
      expectedVersionId: versionId,
      effectiveFrom,
      percentageBps: '1025',
      reason: draftReason,
      contractualBasis: 'Contract clause 7',
    });
    await expect(form).not.toContainText('PRIVATE_SERVER_VALIDATION_TEXT');
    await inspect(page, form, 'electricity-price-proposal-form');
    await reason
      .locator('..')
      .screenshot({ path: info.outputPath(`price-proposal-${locale}-${theme}.png`) });
    state.reviewMode = 'conflict';
    await date.fill('2026-10-13T12:00');
    await review.click();
    await expect(page.getByRole('alert')).toContainText(copy('reviewError'));
    await expect(date).not.toHaveAttribute('aria-invalid', 'true');
    await expect(date).toHaveValue('2026-10-13T12:00');
    await date.fill('2026-10-09T12:00');
    state.reviewMode = 'held';
    await review.click();
    await expect.poll(() => !!state.previewRoute).toBe(true);
    const stale = state.previewRoute!;
    const staleBody = state.previews.at(-1)!;
    const updatedReason = 'Updated tariff\nApplies to the remaining delivery period.';
    await reason.fill(`  ${updatedReason}  `);
    await stale.fulfill({ json: priceReview(staleBody) });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(review).toBeEnabled();
    await expect(reason).toHaveValue(`  ${updatedReason}  `);
    state.previewRoute = undefined;
    await review.click();
    await expect.poll(() => !!state.previewRoute).toBe(true);
    const reviewed = state.previews.at(-1)!;
    const previewCount = state.previews.length;
    await form.dispatchEvent('submit');
    await review.dispatchEvent('click');
    expect(state.previews).toHaveLength(previewCount);
    await state.previewRoute!.fulfill({ json: priceReview(reviewed) });
    let dialog = page.getByRole('dialog');
    const reviewedReason = dialog.locator('dd').filter({ hasText: 'Updated tariff' });
    await expect(reviewedReason).toHaveCount(1);
    expect(await reviewedReason.textContent()).toBe(updatedReason);
    await expect(reviewedReason).toHaveCSS('white-space', 'pre-wrap');
    await expect(dialog).toContainText('Contract clause 7');
    await approveRiskConfirmation(page, locale, 'financial');
    await dialog.locator('button[type=submit]').click();
    await expect.poll(() => !!state.writeRoute).toBe(true);
    const publish = state.writes[0]!;
    expect(publish.body).toEqual({
      ...reviewed,
      expectedReviewHash: priceReview(reviewed).hash,
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    await dialog.locator('form').dispatchEvent('submit');
    expect(state.writes).toHaveLength(1);
    await state.writeRoute!.fulfill({
      status: 201,
      json: { ...priceRow(reviewed), contractId: '88000000-0000-4000-8000-000000000008' },
    });
    await expect(dialog).toHaveCount(0);
    const retry = page.getByRole('button', {
      name: app('electricity.priceForm.retryCaptured'),
      exact: true,
    });
    await expect(retry).toBeEnabled();
    const back = page.getByRole('link', { name: copy('backToHistory'), exact: true });
    await expect(back).toHaveAttribute('aria-disabled', 'true');
    const reads = state.staffReads;
    await back.dispatchEvent('click');
    expect(state.staffReads).toBe(reads);
    await expect(reason).toHaveValue(`  ${updatedReason}  `);
    state.writeMode = 'success';
    await retry.click();
    dialog = page.getByRole('dialog');
    await approveRiskConfirmation(page, locale, 'financial');
    await dialog.locator('button[type=submit]').click();
    await expect(dialog).toHaveCount(0);
    const cancel = page.getByRole('link', { name: copy('cancel'), exact: true });
    await expect(cancel).toBeEnabled();
    expect(state.writes.slice(0, 2)).toEqual([publish, publish]);
    expect(state.previews).toHaveLength(previewCount);
    await expect(form).toHaveCount(0);
    // Cancel has only the captured idempotency key, with no invented reason/hash/version.
    state.writeMode = 'held';
    state.writeRoute = undefined;
    await cancel.click();
    await expect(page).toHaveURL(/\/cancel$/);
    const cancelForm = page.getByRole('form', { name: copy('cancel'), exact: true });
    await expect(cancelForm.locator('button[type=submit]')).toBeDisabled();
    await approveRiskConfirmation(page, locale, 'both');
    await cancelForm.locator('button[type=submit]').click();
    await expect.poll(() => !!state.writeRoute).toBe(true);
    const cancellation = state.writes.at(-1)!;
    expect(cancellation.kind).toBe('cancel');
    expect(cancellation.body).toEqual({ idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    await state.writeRoute!.fulfill({ status: 201, json: {} });
    await expect(cancelForm).toHaveCount(0);
    const backToAdjustment = page.getByRole('link', {
      name: copy('backToAdjustment'),
      exact: true,
    });
    await expect(backToAdjustment).toHaveAttribute('aria-disabled', 'true');
    await backToAdjustment.dispatchEvent('click');
    await expect(page).toHaveURL(/\/cancel$/);
    state.writeMode = 'success';
    await retry.click();
    await approveRiskConfirmation(page, locale, 'both');
    await cancelForm.locator('button[type=submit]').click();
    await expect(page).not.toHaveURL(/\/cancel$/);
    await back.click();
    await page.getByRole('link', { name: copy('newProposal'), exact: true }).click();
    await expect(review).toBeEnabled();
    expect(state.writes.slice(2, 4)).toEqual([cancellation, cancellation]);
    await expect(reason).toHaveValue('');
    // A negative percentage publishes a credit. Finalize must use that actual calculation digest.
    await percentage.fill(' -10.25 ');
    await date.fill('2026-10-09T12:00');
    await reason.fill('  Credit tariff  ');
    await basis.fill('  Contract clause 7  ');
    state.nextAdjustmentId = creditAdjustmentId;
    state.reviewMode = 'success';
    await review.click();
    dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Credit tariff');
    await approveRiskConfirmation(page, locale, 'financial');
    await dialog.locator('button[type=submit]').click();
    await expect(dialog).toHaveCount(0);
    const finalize = page.getByRole('link', { name: copy('finalize'), exact: true });
    await expect(finalize).toBeEnabled();
    const credit = state.rows.find((row) => row.adjustmentId === creditAdjustmentId)!;
    expect(credit.percentageBps).toBe('-1025');
    expect(BigInt(credit.adjustmentAmountIrR)).toBeLessThan(0n);
    state.writeMode = 'held';
    state.writeRoute = undefined;
    await finalize.click();
    await expect(page).toHaveURL(/\/finalize$/);
    const finalizeForm = page.getByRole('form', { name: copy('finalize'), exact: true });
    await approveRiskConfirmation(page, locale, 'financial');
    await finalizeForm.locator('button[type=submit]').click();
    await expect.poll(() => !!state.writeRoute).toBe(true);
    const finalCommand = state.writes.at(-1)!;
    expect(finalCommand.body).toEqual({
      expectedCalculationSha256: credit.calculationSha256,
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    await state.writeRoute!.fulfill({ status: 201, json: {} });
    await expect(finalizeForm).toHaveCount(0);
    state.writeMode = 'success';
    await retry.click();
    await approveRiskConfirmation(page, locale, 'financial');
    await finalizeForm.locator('button[type=submit]').click();
    await expect(page).not.toHaveURL(/\/finalize$/);
    await expect(page.locator(`a[href="/admin/invoices/${linkedCreditId}"]:visible`)).toBeVisible();
    expect(state.writes.slice(-2)).toEqual([finalCommand, finalCommand]);
    expect(state.rows.find((row) => row.adjustmentId === creditAdjustmentId)!.status).toBe(
      'finalized'
    );
  });
  test(`stalled electricity price verification releases an unsent command (${locale}, ${theme})`, async ({
    page,
  }) => {
    await page.clock.install();
    const state = await setupElectricityPriceAdjustmentForms(page, locale, theme === 'dark');
    state.auth.context = 'staff';
    state.reviewMode = 'success';
    let verification: Route | undefined;
    await page.route('**/api/auth/step-up', (route) => {
      verification = route;
    });
    await page.goto('/admin/electricity-price-adjustments');
    const picker = page.locator('#electricity-price-contract');
    await picker.fill(contractId);
    await picker.press('Enter');
    await page.getByRole('link', { name: copy('newProposal'), exact: true }).click();
    const review = page.getByTestId('electricity-price-proposal-form').getByRole('button', {
      name: copy('reviewProposal'),
      exact: true,
    });
    await page.locator('#price-percent').fill('10.25');
    await page.locator('#price-effective').fill('2026-10-09T12:00');
    const reason = page.locator('#price-reason');
    await reason.fill('Tariff reviewed');
    await page.locator('#price-basis').fill('Contract clause 7');
    await review.click();
    const dialog = page.getByRole('dialog');
    const confirm = dialog.locator('button[type=submit]');
    await approveRiskConfirmation(page, locale, 'financial');
    await confirm.click();
    await expect.poll(() => !!state.writeRoute).toBe(true);
    await state.writeRoute!.fulfill({ status: 403, json: { requiresStepUp: true } });
    await dialog.getByLabel(app('team.password'), { exact: true }).fill('fixture-only-password');
    await confirm.click();
    await expect.poll(() => !!verification).toBe(true);
    await page.clock.fastForward(15_001);
    await expect(dialog.getByRole('alert')).toBeVisible();
    await dialog.getByRole('button', { name: app('team.cancel'), exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(review).toBeEnabled();
    await expect(reason).toHaveValue('Tariff reviewed');
    await expect(
      page.getByRole('button', { name: app('electricity.priceForm.retryCaptured'), exact: true })
    ).toHaveCount(0);
    await verification!.fulfill({ json: { verified: true } }).catch(() => {});
    expect(state.writes).toHaveLength(1);
    expect(state.previews).toHaveLength(1);
  });
  test(`staff electricity price proposal recovers from a stalled acknowledgement (${locale}, ${theme})`, async ({
    page,
  }) => {
    await page.clock.install();
    const state = await setupElectricityPriceAdjustmentForms(page, locale, theme === 'dark');
    state.auth.context = 'staff';
    state.reviewMode = 'success';
    await page.goto('/admin/electricity-price-adjustments');
    const picker = page.locator('#electricity-price-contract');
    await picker.fill(contractId);
    await picker.press('Enter');
    await page.getByRole('link', { name: copy('newProposal'), exact: true }).click();
    const form = page.getByTestId('electricity-price-proposal-form');
    const review = form.getByRole('button', { name: copy('reviewProposal'), exact: true });
    await page.locator('#price-percent').fill('10.25');
    await page.locator('#price-effective').fill('2026-10-09T12:00');
    const reason = page.locator('#price-reason');
    await reason.fill('  Tariff reviewed  ');
    await page.locator('#price-basis').fill('Contract clause 7');
    await review.click();
    const dialog = page.getByRole('dialog');
    await approveRiskConfirmation(page, locale, 'financial');
    await dialog.locator('button[type=submit]').click();
    await expect.poll(() => !!state.writeRoute).toBe(true);
    const stale = state.writeRoute!;
    const original = stale.request().postData();
    const captured = state.writes[0];
    expect(captured?.body.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    await page.clock.fastForward(15_001);
    const retry = page.getByRole('button', {
      name: app('electricity.priceForm.retryCaptured'),
      exact: true,
    });
    await expect(retry).toBeEnabled({ timeout: 2_000 });
    await expect(dialog).toHaveCount(0);
    await expect(reason).toHaveValue('  Tariff reviewed  ');
    await expect(review).toBeDisabled();
    expect(state.writes).toEqual([captured]);
    await stale.fulfill({ status: 403, json: { error: 'AUTHZ:FORBIDDEN' } }).catch(() => {});
    await expect(retry).toBeEnabled();
    state.writeRoute = undefined;
    await retry.click();
    await approveRiskConfirmation(page, locale, 'financial');
    await dialog.locator('button[type=submit]').click();
    await expect.poll(() => !!state.writeRoute).toBe(true);
    await state.writeRoute!.fulfill({ status: 403, json: { requiresStepUp: true } });
    await expect(dialog.getByLabel(app('team.password'), { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: app('team.cancel'), exact: true }).click();
    await expect(retry).toBeEnabled();
    expect(state.writes).toEqual([captured, captured]);
    state.writeMode = 'success';
    await retry.click();
    await expect(dialog.locator('button[type=submit]')).toBeDisabled();
    await approveRiskConfirmation(page, locale, 'financial');
    const replay = page.waitForRequest(
      (request) => request.method() === 'POST' && request.url() === stale.request().url()
    );
    await dialog.locator('button[type=submit]').click();
    expect((await replay).postData()).toBe(original);
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('link', { name: copy('cancel'), exact: true })).toBeEnabled();
    expect(state.writes).toEqual([captured, captured, captured]);
    expect(state.previews).toHaveLength(1);
  });

  test(`customer price disclosure rejects malformed rows and denied recovery (${locale}, ${theme})`, async ({
    page,
  }, info) => {
    const state = await setupElectricityPriceAdjustmentForms(page, locale, theme === 'dark');
    await page.goto(`/electricity/orders/${orderId}`);
    const history = page.getByTestId('electricity-price-history');
    await expect(history).toContainText(app('electricity.priceAdjustment.beforeFinalization'));
    await expect(history).toContainText(defaultPriceInput.reason);
    await expect(history).toContainText(defaultPriceInput.contractualBasis);
    await expect(history.locator('script')).toHaveCount(0);
    const details = history.locator('details').first();
    await details.locator('summary').click();
    await expect(details).toContainText(app('electricity.priceAdjustment.source.original_invoice'));
    await inspect(page, history, 'electricity-price-history');
    await history
      .locator('dl')
      .first()
      .screenshot({ path: info.outputPath(`price-disclosure-${locale}-${theme}.png`) });
    const credit = finalizedPrice(
      priceRow(
        { ...defaultPriceInput, percentageBps: '-1000', reason: 'Finalized credit explanation' },
        creditAdjustmentId
      )
    );
    const cancelled = cancelledPrice(priceRow(defaultPriceInput, cancelledAdjustmentId));
    state.customerRows = [credit, cancelled];
    await page.reload();
    await expect(history).toContainText(app('electricity.priceAdjustment.status.finalized'));
    await expect(history).toContainText(app('electricity.priceAdjustment.status.cancelled'));
    await expect(history).toContainText('Finalized credit explanation');
    await expect(history.locator(`a[href="/invoices/${linkedCreditId}"]`)).toHaveText(
      app('electricity.priceAdjustment.viewCredit')
    );
    await expect(history.locator('button')).toHaveCount(0);
    state.readMode = 'malformed';
    await page.reload();
    await expect(history).toContainText(app('electricity.priceAdjustment.error'));
    await expect(history).not.toContainText('INVALID_AMOUNT');
    await expect(history).not.toContainText(defaultPriceInput.reason);
    const retry = page.getByTestId('electricity-price-history-retry');
    state.readMode = 'held';
    await retry.click();
    await expect.poll(() => !!state.readRoute).toBe(true);
    await expect(retry).toHaveCount(0);
    const reads = state.customerReads;
    await state.readRoute!.fulfill({ status: 503, json: {} });
    await expect(retry).toBeEnabled();
    expect(state.customerReads).toBe(reads);
    state.readMode = locale === 'en' ? 'denied' : 'missing';
    await retry.click();
    await expect(retry).toBeEnabled();
    await expect(history).not.toContainText('Finalized credit explanation');
    await expect(history).not.toContainText(defaultPriceInput.reason);
    await expect(history.locator('a[href^="/invoices/"]')).toHaveCount(0);
    await expect(history).not.toContainText('PRIVATE_SERVER_VALIDATION_TEXT');
    expect(state.writes).toEqual([]);
  });
}
