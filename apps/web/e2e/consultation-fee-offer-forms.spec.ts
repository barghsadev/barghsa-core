import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import type { ConsultationPaidFeeReview } from '@barghsa/shared/finance';
import { ErrorCodes } from '@barghsa/shared/errors';
import { t } from '@barghsa/i18n/app';
import { tConsultation } from '@barghsa/i18n/consultation';
import { tConsultationFee } from '@barghsa/i18n/consultation-fee';
import { test, expect } from './coverage-fixture';
import {
  setupConsultationFeeOffers,
  informationRequest,
  unpaidRequest,
  paidRequest,
  originalDeadline,
  originalInvoice,
  type FeeTerms,
  type PaidTerms,
} from './consultation-fee-offer-form-fixture';

const commandKey = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const generatedId = /^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
async function focusedError(field: Locator) {
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(field).toHaveAttribute('aria-describedby', /-description.*-message/);
}
async function inspect(page: Page, region: Locator, selector: string, button: Locator) {
  const focused = await page.evaluate(() => document.activeElement?.id);
  await button.hover();
  expect(await page.evaluate(() => document.activeElement?.id)).toBe(focused);
  expect((await new AxeBuilder({ page }).include(selector).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const control of await region.locator('input,textarea,select,button').all()) {
    const box = await control.boundingBox();
    if (box) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
    }
  }
}
async function fieldCapture(field: Locator, path: string) {
  const region = field.locator('..');
  await region.scrollIntoViewIfNeeded();
  await region.evaluate((node) => window.scrollBy(0, node.getBoundingClientRect().top - 200));
  await region.screenshot({ path });
}
async function outcomeCapture(page: Page, region: Locator, path: string) {
  const total = region.locator(':scope > dl').last();
  const notice = region.locator(':scope > div').last();
  await notice.scrollIntoViewIfNeeded();
  const a = await total.boundingBox(),
    b = await notice.boundingBox();
  expect(a).not.toBeNull();
  expect(b).not.toBeNull();
  await page.screenshot({
    path,
    clip: { x: b!.x, y: a!.y, width: b!.width, height: b!.y + b!.height - a!.y },
  });
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
    '**/' + manifest['src/lib/consultation-fee-form-schemas.ts'].file,
    async (route) => {
      await held;
      await route.continue();
    }
  );
  return release;
}
async function chooseExternally(page: Page, id: string) {
  await page.evaluate((id) => {
    const url = new URL(location.href);
    url.searchParams.set('requestId', id);
    window.history.pushState({}, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, id);
}
for (const [locale, theme] of [
  ['en', 'light'],
  ['fa', 'dark'],
] as const) {
  const copy = (key: string) => tConsultation(key, locale);
  const formCopy = (key: string) => tConsultationFee(key, locale);
  const form = (page: Page) => page.getByTestId('consultation-fee-form');
  const fee = (page: Page) => page.locator('#consultation-fee');
  const deadline = (page: Page) => page.locator('#consultation-valid-until');
  const reason = (page: Page) => page.locator('#consultation-offer-reason');
  const staffReason = (page: Page) => page.locator('#consultation-reason');
  const submit = (page: Page) => form(page).locator('button[type=submit]');
  const retry = (page: Page) => page.getByTestId('consultation-fee-retry');
  const dialog = (page: Page) => page.getByRole('dialog');
  const confirm = (page: Page) => dialog(page).locator('button[type=submit]');
  const cancel = (page: Page) =>
    dialog(page).getByRole('button', { name: t('team.cancel', locale), exact: true });
  const refresh = (page: Page) =>
    page.getByRole('button', { name: copy('refresh'), exact: true }).first();
  async function password(page: Page) {
    const field = dialog(page).getByLabel(t('team.password', locale), { exact: true });
    await expect(field).toBeVisible();
    await field.fill('Consultation-fee-proof-42!');
    await confirm(page).click();
  }
  test(`consultation initial and unpaid replacement retain exact saved outcomes (${locale}, ${theme})`, async ({
    page,
  }, info) => {
    const { state, feeReview, persist, acceptAndPay } = await setupConsultationFeeOffers(
      page,
      locale
    );
    const release = await holdSchema(page);
    await page.goto(`/admin/consultations?requestId=${informationRequest}`);
    await expect(fee(page)).toBeVisible();
    const scope = page.locator('#consultation-scope'),
      deliverables = page.locator('#consultation-deliverables');
    await staffReason(page).fill('  Independent nonfinancial decision draft  ');
    await fee(page).fill('0');
    await scope.fill('  Supply assessment  ');
    await deliverables.fill('  Written energy report  ');
    await deadline(page).fill('2030-03-01T12:17');
    await submit(page).click();
    await expect(submit(page)).toBeDisabled();
    await form(page).dispatchEvent('submit');
    expect(state.previews).toEqual([]);
    release();
    await focusedError(fee(page));
    await expect(scope).toHaveValue('  Supply assessment  ');
    await fee(page).fill('9223372036854775808');
    await submit(page).click();
    await focusedError(fee(page));
    await fee(page).fill('600000');
    await scope.fill('x'.repeat(4001));
    await submit(page).click();
    await focusedError(scope);
    await scope.fill('  Supply assessment  ');
    await deliverables.fill('x'.repeat(4001));
    await submit(page).click();
    await focusedError(deliverables);
    await deliverables.fill('  Written energy report  ');
    await deadline(page).fill('2000-01-01T12:30');
    await submit(page).click();
    await focusedError(deadline(page));
    expect(state.previews).toEqual([]);
    await deadline(page).fill('2030-03-01T12:17');
    state.previewMode = 'owned';
    state.ownedFields = ['fee'];
    await submit(page).click();
    await focusedError(fee(page));
    await expect(form(page)).not.toContainText('PRIVATE_FEE_SERVER_TEXT');
    await expect(staffReason(page)).toHaveValue('  Independent nonfinancial decision draft  ');
    await inspect(page, form(page), '[data-testid="consultation-fee-form"]', submit(page));
    expect(state.previews[0]!.body).toEqual({
      fee: '600000',
      scope: 'Supply assessment',
      deliverables: 'Written energy report',
      validUntil: '2030-03-01T08:47:00.000Z',
    });
    state.previewMode = 'mixed';
    await submit(page).click();
    await expect(page.locator('#admin-content').getByRole('alert')).toContainText(
      copy('loadError')
    );
    await expect(fee(page)).not.toHaveAttribute('aria-invalid', 'true');
    state.previewMode = 'foreign';
    await submit(page).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.locator('#admin-content').getByRole('alert')).toContainText(
      copy('loadError')
    );
    await expect(page.locator('#admin-content')).not.toContainText('PRIVATE_FEE_SERVER_TEXT');
    state.previewMode = 'success';
    await submit(page).click();
    await expect(dialog(page)).toContainText(copy('feeReviewIssueOutcome'));
    await expect(dialog(page)).toContainText('Supply assessment');
    await expect(dialog(page)).toContainText('Written energy report');
    await inspect(page, dialog(page), '[role="dialog"]', confirm(page));
    state.writeMode = 'held';
    state.needsStepUp = true;
    await confirm(page).click();
    await password(page);
    await expect.poll(() => !!state.heldWrite).toBe(true);
    const command = state.writes.at(-1)!;
    const review = feeReview(informationRequest, command.body as unknown as FeeTerms);
    expect(command.body).toEqual({
      ...state.previews.at(-1)!.body,
      expectedReviewHash: review.hash,
      idempotencyKey: expect.stringMatching(commandKey),
    });
    await dialog(page).locator('form').dispatchEvent('submit');
    expect(state.writes).toHaveLength(2);
    const receipt = persist(command);
    expect(receipt).toEqual({
      requestId: informationRequest,
      status: 'offer_pending',
      invoiceId: expect.stringMatching(generatedId),
      financialReview: review,
    });
    // Payment progress does not change the result bound to the original key/body/hash.
    acceptAndPay(informationRequest);
    await state.heldWrite!.fulfill({
      json: { ...receipt, financialReview: { ...review, data: { ...review.data, fee: '600001' } } },
    });
    await expect(retry(page)).toHaveText(formCopy('retryCaptured'));
    await expect(dialog(page)).toHaveCount(0);
    await expect(fee(page)).toBeDisabled();
    const reads = state.reads.length;
    await refresh(page).dispatchEvent('click');
    await form(page).dispatchEvent('submit');
    expect(state.reads).toHaveLength(reads);
    expect(state.writes).toHaveLength(2);
    state.writeMode = 'rejected';
    await retry(page).click();
    await confirm(page).click();
    await expect(cancel(page)).toBeEnabled();
    await cancel(page).click();
    await expect(retry(page)).toBeEnabled();
    state.writeMode = 'success';
    await retry(page).click();
    await confirm(page).click();
    await expect(retry(page)).toHaveCount(0);
    await expect(submit(page)).toHaveText(copy('adjustPaidFee'));
    await expect(staffReason(page)).toHaveValue('  Independent nonfinancial decision draft  ');
    expect(state.writes.map((call) => call.raw)).toEqual(Array(4).fill(command.raw));
    expect(state.writes.slice(1).map((call) => call.csrf)).toEqual(
      Array(3).fill('consultation-fee-rotated')
    );
    expect(state.effects).toBe(1);

    await page.getByRole('button', { name: /Replacement consultation buyer/ }).click();
    await expect(submit(page)).toHaveText(copy('replaceFee'));
    await expect(deadline(page)).toHaveValue('2030-01-01T12:30');
    await expect(staffReason(page)).toHaveValue('');
    await staffReason(page).fill('  Keep the replacement decision draft  ');
    await fee(page).fill('550000');
    await reason(page).fill('x'.repeat(2001));
    await submit(page).click();
    await focusedError(reason(page));
    await reason(page).fill('  Clarified work and replacement invoice  ');
    state.previewMode = 'owned';
    state.ownedFields = ['reason'];
    await submit(page).click();
    await focusedError(reason(page));
    await expect(reason(page)).toHaveValue('  Clarified work and replacement invoice  ');
    await expect(deadline(page)).toHaveValue('2030-01-01T12:30');
    await inspect(page, form(page), '[data-testid="consultation-fee-form"]', submit(page));
    await fieldCapture(
      reason(page),
      info.outputPath(`consultation-replacement-fields-${locale}-${theme}.png`)
    );
    state.previewMode = 'success';
    const oldInvoice = state.rows[unpaidRequest]!.invoice_id;
    await submit(page).click();
    const replacement = state.previews.at(-1)!;
    expect(replacement.body.validUntil).toBe(originalDeadline);
    await expect(dialog(page)).toContainText(copy('feeReviewReplaceOutcome'));
    await expect(dialog(page)).toContainText(oldInvoice!);
    await inspect(page, dialog(page), '[role="dialog"]', confirm(page));
    await outcomeCapture(
      page,
      dialog(page).getByRole('region', { name: copy('feeReviewTitle'), exact: true }),
      info.outputPath(`consultation-replacement-outcome-${locale}-${theme}.png`)
    );
    state.writeMode = 'held';
    state.heldWrite = undefined;
    await confirm(page).click();
    await expect.poll(() => !!state.heldWrite).toBe(true);
    const replaceCommand = state.writes.at(-1)!;
    const replaced = persist(replaceCommand);
    expect(replaced.invoiceId).not.toBe(oldInvoice);
    expect(state.invoices.get(oldInvoice!)!.state).toBe('Cancelled');
    await state.heldWrite!.fulfill({ status: 503, json: {} });
    await expect(retry(page)).toBeVisible();
    state.writeMode = 'success';
    await retry(page).click();
    await confirm(page).click();
    await expect(retry(page)).toHaveCount(0);
    await expect(reason(page)).toHaveValue('');
    await expect(staffReason(page)).toHaveValue('  Keep the replacement decision draft  ');
    expect(
      state.writes.filter((call) => call.id === unpaidRequest).map((call) => call.raw)
    ).toEqual([replaceCommand.raw, replaceCommand.raw]);
    expect(state.effects).toBe(2);

    await fee(page).fill('560000');
    await reason(page).fill('  Old private replacement preview  ');
    state.previewMode = 'held';
    state.heldPreview = undefined;
    await submit(page).click();
    await expect.poll(() => !!state.heldPreview).toBe(true);
    const oldPreview = state.heldPreview!;
    await chooseExternally(page, paidRequest);
    await expect(submit(page)).toHaveText(copy('adjustPaidFee'));
    await expect(reason(page)).toHaveValue('');
    await oldPreview
      .fulfill({
        status: 403,
        json: {
          error: {
            code: ErrorCodes.AUTHZ_FORBIDDEN.code,
            correlationId: unpaidRequest,
            message: 'OLD_PRIVATE_FEE_TEXT',
          },
        },
      })
      .catch(() => {});
    await expect(fee(page)).toBeVisible();
    await expect(form(page)).not.toContainText('OLD_PRIVATE_FEE_TEXT');
    await fee(page).fill('550000');
    await reason(page).fill('  Current private fee adjustment  ');
    state.previewMode = locale === 'en' ? 'missing' : 'denied';
    await submit(page).click();
    await expect(fee(page)).toHaveCount(0);
    await expect(staffReason(page)).toHaveCount(0);
    await expect(dialog(page)).toHaveCount(0);
  });

  test(`consultation paid increase and credit preserve full refund outcomes (${locale}, ${theme})`, async ({
    page,
  }, info) => {
    const { state, paidReview, persist, acceptAndPay } = await setupConsultationFeeOffers(
      page,
      locale
    );
    await page.goto(`/admin/consultations?requestId=${paidRequest}`);
    await expect(submit(page)).toHaveText(copy('adjustPaidFee'));
    await expect(deadline(page)).toHaveValue('2030-01-01T12:30');
    await staffReason(page).fill('  Independent paid consultation decision  ');
    await submit(page).click();
    await focusedError(fee(page));
    await fee(page).fill('700000');
    await reason(page).fill('x'.repeat(1001));
    await submit(page).click();
    await focusedError(reason(page));
    await reason(page).fill('  Expanded paid consultation  ');
    state.previewMode = 'owned';
    state.ownedFields = ['reason'];
    await submit(page).click();
    await focusedError(reason(page));
    await expect(fee(page)).toHaveValue('700000');
    await expect(deadline(page)).toHaveValue('2030-01-01T12:30');
    await expect(form(page)).not.toContainText('PRIVATE_FEE_SERVER_TEXT');
    await inspect(page, form(page), '[data-testid="consultation-fee-form"]', submit(page));
    await fieldCapture(
      reason(page),
      info.outputPath(`consultation-paid-fields-${locale}-${theme}.png`)
    );
    state.previewMode = 'success';
    await submit(page).click();
    const chargeReview = paidReview(
      paidRequest,
      state.previews.at(-1)!.body as unknown as PaidTerms
    );
    expect(chargeReview.data.refundPlan).toEqual([]);
    await expect(dialog(page)).toContainText(copy('paidFeeReviewChargeOutcome'));
    await expect(dialog(page)).toContainText('Supply assessment');
    await expect(dialog(page)).toContainText('Written report');
    await expect(dialog(page)).toContainText(originalInvoice);
    await inspect(page, dialog(page), '[role="dialog"]', confirm(page));
    state.needsStepUp = true;
    state.writeMode = 'held';
    await confirm(page).click();
    await password(page);
    await expect.poll(() => !!state.heldWrite).toBe(true);
    const charge = state.writes.at(-1)!;
    expect(charge.body).toEqual({
      fee: '700000',
      reason: 'Expanded paid consultation',
      validUntil: originalDeadline,
      expectedReviewHash: chargeReview.hash,
      idempotencyKey: expect.stringMatching(commandKey),
    });
    await dialog(page).locator('form').dispatchEvent('submit');
    expect(state.writes).toHaveLength(2);
    const charged = persist(charge);
    expect(charged).toEqual({
      requestId: paidRequest,
      status: 'offer_pending',
      invoiceId: expect.stringMatching(generatedId),
      adjustmentInvoiceId: charged.invoiceId,
      refundIds: [],
      financialReview: chargeReview,
    });
    expect(charged.adjustmentInvoiceId).not.toBe(originalInvoice);
    acceptAndPay(paidRequest);
    await state.heldWrite!.fulfill({ json: { ...charged, status: 'offer_accepted' } });
    await expect(retry(page)).toBeVisible();
    await expect(fee(page)).toBeDisabled();
    const reads = state.reads.length;
    // A preference refresh is not authority withdrawal and cannot erase an attempted command.
    state.timezone = 'Pacific/Kiritimati';
    state.holdTimezone = true;
    await page.evaluate(() => window.dispatchEvent(new Event('barghsa:timezone-changed')));
    await expect.poll(() => !!state.heldTimezone).toBe(true);
    await expect(retry(page)).toBeEnabled();
    await expect(deadline(page)).toBeDisabled();
    await expect(deadline(page)).toHaveValue('2030-01-01T12:30');
    await state.heldTimezone!.fulfill({ json: { timezone: state.timezone } });
    state.holdTimezone = false;
    await refresh(page).dispatchEvent('click');
    await form(page).dispatchEvent('submit');
    expect(state.reads).toHaveLength(reads);
    expect(state.writes.at(-1)!.raw).toBe(charge.raw);
    state.writeMode = 'success';
    await retry(page).click();
    await confirm(page).click();
    await expect(retry(page)).toHaveCount(0);
    await expect(submit(page)).toHaveText(copy('adjustPaidFee'));
    await expect(fee(page)).toHaveValue('700000');
    await expect(deadline(page)).toHaveValue('2030-01-01T23:00');
    await expect(reason(page)).toHaveValue('');
    await expect(staffReason(page)).toHaveValue('  Independent paid consultation decision  ');
    expect(state.writes.map((call) => call.raw)).toEqual(Array(3).fill(charge.raw));
    expect(state.writes.slice(1).map((call) => call.csrf)).toEqual(
      Array(2).fill('consultation-fee-rotated')
    );
    expect(state.verifications).toEqual([{ password: 'Consultation-fee-proof-42!' }]);

    await fee(page).fill('300000');
    await reason(page).fill('  Reduced paid consultation scope  ');
    await submit(page).click();
    await expect.poll(() => state.previews.at(-1)?.body.fee).toBe('300000');
    await expect(dialog(page)).toContainText(copy('paidFeeReviewCreditOutcome'));
    const creditReview = paidReview(
      paidRequest,
      state.previews.at(-1)!.body as unknown as PaidTerms
    );
    expect(creditReview.data).toMatchObject({
      previousFee: '700000',
      revisedFee: '300000',
      difference: '-400000',
      paidInvoice: { totalAmount: '200000', paidAmount: '200000' },
      refundPlan: [
        { invoiceId: charged.invoiceId, amount: '200000', availableBefore: '200000' },
        { invoiceId: originalInvoice, amount: '200000', availableBefore: '500000' },
      ],
    });
    await expect(dialog(page)).toContainText(copy('paidFeeReviewCreditOutcome'));
    await expect(dialog(page)).toContainText(String(charged.invoiceId));
    await expect(dialog(page)).toContainText(originalInvoice);
    await expect(dialog(page)).toContainText(
      `${new Intl.NumberFormat(locale).format(400000n)} IRR`
    );
    await inspect(page, dialog(page), '[role="dialog"]', confirm(page));
    await outcomeCapture(
      page,
      dialog(page).getByRole('region', { name: copy('paidFeeReviewTitle'), exact: true }),
      info.outputPath(`consultation-credit-outcome-${locale}-${theme}.png`)
    );
    state.writeMode = 'held';
    state.heldWrite = undefined;
    await confirm(page).click();
    await expect.poll(() => !!state.heldWrite).toBe(true);
    const credit = state.writes.at(-1)!;
    const credited = persist(credit),
      refundIds = credited.refundIds as string[];
    expect(refundIds).toHaveLength(2);
    expect(new Set(refundIds).size).toBe(2);
    expect(refundIds.every((id) => generatedId.test(id))).toBe(true);
    expect(credited.invoiceId).toBe(charged.invoiceId);
    expect(credited.adjustmentInvoiceId).not.toBe(credited.invoiceId);
    expect((credited.financialReview as ConsultationPaidFeeReview).data.refundPlan).toEqual(
      creditReview.data.refundPlan
    );
    await state.heldWrite!.fulfill({
      json: { ...credited, refundIds: [refundIds[0], refundIds[0]] },
    });
    await expect(retry(page)).toBeVisible();
    await expect(reason(page)).toHaveValue('  Reduced paid consultation scope  ');
    // The exact persisted receipt is returned even though the current fee/refund balances moved.
    state.writeMode = 'success';
    await retry(page).click();
    await confirm(page).click();
    await expect(retry(page)).toHaveCount(0);
    await expect(fee(page)).toHaveValue('300000');
    await expect(reason(page)).toHaveValue('');
    await expect(staffReason(page)).toHaveValue('  Independent paid consultation decision  ');
    expect(state.writes.slice(3).map((call) => call.raw)).toEqual([credit.raw, credit.raw]);
    expect(state.effects).toBe(2);
    await fee(page).fill('350000');
    await reason(page).fill('  Private current credit request  ');
    state.previewMode = 'denied';
    await submit(page).click();
    await expect(fee(page)).toHaveCount(0);
    await expect(staffReason(page)).toHaveCount(0);
    await expect(dialog(page)).toHaveCount(0);
  });
}
