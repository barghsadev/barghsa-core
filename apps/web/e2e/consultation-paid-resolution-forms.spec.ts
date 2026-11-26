import { productionManifest } from './production-manifest';
import { approveRiskConfirmation } from './confirmation-fixture';
import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import type { ConsultationPaidResolutionReview } from '@barghsa/shared/finance';
import { ErrorCodes } from '@barghsa/shared/errors';
import { t } from '@barghsa/i18n/app';
import { tStaffConsultation } from '@barghsa/i18n/consultation-staff';
import { tConsultationResolution } from '@barghsa/i18n/consultation-resolution';
import { test, expect } from './coverage-fixture';
import {
  setupConsultationPaidResolution,
  closureRequest,
  recoveryRequest,
  closurePaidCharge,
  closureUnpaidCharge,
  closureOriginal,
  recoveryPaidCharge,
  recoveryOriginal,
  jsonbOrder,
  type ResolutionAction,
} from './consultation-paid-resolution-form-fixture';

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
  const total = region.locator(':scope > dl').last(),
    notice = region.locator(':scope > div').last();
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
  const manifest = await productionManifest();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/' + manifest['src/lib/consultation-form-schemas.ts'].file, async (route) => {
    await held;
    await route.continue();
  });
  return release;
}
async function chooseExternally(page: Page, id: string, decision: string) {
  await page.evaluate(
    ({ id, decision }) => {
      const url = new URL(location.href);
      url.pathname = '/admin/consultations/' + id + '/decisions/' + decision;
      url.searchParams.delete('requestId');
      window.history.pushState({}, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    },
    { id, decision }
  );
}
for (const [locale, theme] of [
  ['en', 'light'],
  ['fa', 'dark'],
] as const) {
  const copy = (key: string) => tStaffConsultation(key, locale);
  const resolutionCopy = (key: string) => tConsultationResolution(key, locale);
  const reason = (page: Page) => page.locator('#consultation-reason');
  const reasonForm = (page: Page) => reason(page).locator('xpath=ancestor::form');
  const feeForm = (page: Page) => page.getByTestId('consultation-fee-form');
  const backToRequest = (page: Page) =>
    page.getByRole('link', { name: copy('backToFeeRequest'), exact: true });
  const decisionLink = (page: Page, decision: string) =>
    page.locator(`a[href*="/decisions/${decision}"]`);
  const openDecision = (page: Page, decision: string) => decisionLink(page, decision).click();
  const dialog = (page: Page) => page.getByRole('dialog');
  const confirm = (page: Page) => dialog(page).locator('button[type=submit]');
  const cancel = (page: Page) =>
    dialog(page).getByRole('button', { name: t('team.cancel', locale), exact: true });
  const retry = (page: Page) => page.getByTestId('consultation-resolution-retry');
  const reviewDecision = (page: Page) =>
    reasonForm(page).getByRole('button', { name: copy('reviewDecision'), exact: true });
  const refresh = (page: Page) =>
    page.getByRole('button', { name: copy('refresh'), exact: true }).first();
  async function withFeeEditor(page: Page, check: () => Promise<void>) {
    const path = new URL(page.url()).pathname.replace(/\/$/, '') + '/fee';
    const link = page.locator(`a[href="${path}"], a[href^="${path}?"]`);
    if (await link.count()) {
      await link.click();
      await expect(feeForm(page)).toBeVisible();
      await check();
      await backToRequest(page).click();
    }
  }
  async function companions(page: Page) {
    await page.locator('#consultation-team').selectOption('Operations');
    await withFeeEditor(page, async () => {
      await expect(page.locator('#consultation-valid-until')).toBeEnabled();
      await page.locator('#consultation-fee').fill('680000');
      await page.locator('#consultation-offer-reason').fill('  Independent fee adjustment draft  ');
      await page.locator('#consultation-valid-until').fill('2030-02-01T12:00');
    });
  }
  async function preservedCompanions(page: Page, reopen?: string) {
    await page.clock.fastForward(6_000);
    await backToRequest(page).click();
    await expect(page.locator('#consultation-team')).toHaveValue('Operations');
    await withFeeEditor(page, async () => {
      await expect(page.locator('#consultation-fee')).toHaveValue('680000');
      await expect(page.locator('#consultation-offer-reason')).toHaveValue(
        '  Independent fee adjustment draft  '
      );
      await expect(page.locator('#consultation-valid-until')).toHaveValue('2030-02-01T12:00');
    });
    if (reopen) {
      await openDecision(page, reopen);
      await expect(reason(page)).toBeVisible();
    }
  }
  async function password(page: Page) {
    const field = dialog(page).getByLabel(t('team.password', locale), { exact: true });
    await expect(field).toBeVisible();
    await field.fill('Consultation-resolution-proof-42!');
    await approveRiskConfirmation(page, locale, 'both');
    await confirm(page).click();
  }
  async function financialSummary(page: Page, review: ConsultationPaidResolutionReview) {
    await expect(dialog(page)).toContainText(review.data.profileName);
    await expect(dialog(page)).toContainText(review.data.serviceTitle[locale]);
    await expect(dialog(page)).toContainText(review.data.reason);
    await expect(dialog(page)).toContainText(copy(`status_${review.data.currentStatus}`));
    await expect(dialog(page)).toContainText(copy(`status_${review.data.resultingStatus}`));
    if (review.data.currentInvoice)
      await expect(dialog(page)).toContainText(review.data.currentInvoice.id);
    if (review.data.cancelInvoiceId)
      await expect(dialog(page)).toContainText(review.data.cancelInvoiceId);
    for (const allocation of review.data.refundAllocations) {
      await expect(dialog(page)).toContainText(allocation.invoiceId);
      await expect(dialog(page)).toContainText(
        new Intl.NumberFormat(locale).format(BigInt(allocation.amount)) + ' IRR'
      );
    }
    await expect(dialog(page)).toContainText(
      new Intl.NumberFormat(locale).format(BigInt(review.data.totalRefund)) + ' IRR'
    );
    await expect(dialog(page)).toContainText(
      copy(
        review.data.action === 'recover_refund'
          ? 'paidResolutionRecoveryOutcome'
          : 'paidResolutionCloseOutcome'
      )
    );
  }
  test(`consultation paid ${locale === 'en' ? 'cancellation cancels unpaid charge' : 'rejection retains paid invoice'} preserves reviewed refunds (${locale}, ${theme})`, async ({
    page,
  }, info) => {
    const { state, review, persist, progressRefunds } = await setupConsultationPaidResolution(
      page,
      locale
    );
    const release = await holdSchema(page);
    const action: ResolutionAction = locale === 'en' ? 'cancel' : 'reject';
    await page.goto(`/admin/consultations?requestId=${closureRequest}`);
    await companions(page);
    await openDecision(page, action);
    await reason(page).focus();
    await reason(page).fill('x'.repeat(1001));
    await reviewDecision(page).click();
    await expect(reviewDecision(page)).toBeDisabled();
    await reviewDecision(page).dispatchEvent('click');
    expect(state.previews).toEqual([]);
    release();
    await focusedError(reason(page));
    await preservedCompanions(page, action);
    await expect(reason(page)).toHaveValue('x'.repeat(1001));
    await reason(page).fill('  Close the paid service; return available payments  ');
    state.previewMode = 'owned';
    await reviewDecision(page).click();
    await focusedError(reason(page));
    await expect(reason(page)).toHaveValue('  Close the paid service; return available payments  ');
    await expect(reasonForm(page)).not.toContainText('PRIVATE_RESOLUTION_SERVER_TEXT');
    await inspect(page, reasonForm(page), 'form:has(#consultation-reason)', reviewDecision(page));
    await fieldCapture(
      reason(page),
      info.outputPath(`consultation-closure-fields-${locale}-${theme}.png`)
    );
    expect(state.previews.at(-1)!.body).toEqual({
      action,
      reason: 'Close the paid service; return available payments',
    });
    state.previewMode = 'mixed';
    await reviewDecision(page).click();
    await expect(page.locator('main[data-area=admin]').getByRole('alert')).toContainText(
      copy('loadError')
    );
    await expect(reason(page)).not.toHaveAttribute('aria-invalid', 'true');
    state.previewMode = 'foreign';
    const foreignPreviewCount = state.previews.length + 1;
    await reviewDecision(page).click();
    await expect.poll(() => state.previews.length).toBe(foreignPreviewCount);
    await expect(reviewDecision(page)).toBeEnabled();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.locator('main[data-area=admin]')).not.toContainText(
      'PRIVATE_RESOLUTION_SERVER_TEXT'
    );
    state.previewMode = 'success';
    await reviewDecision(page).click();
    await expect(dialog(page)).toContainText(copy('paidResolutionCloseOutcome'));
    await expect(
      dialog(page).getByRole('heading', { name: copy(action), exact: true })
    ).toBeFocused();
    expect(await dialog(page).evaluate((element) => element.scrollTop)).toBe(0);
    const quoted = review(
      closureRequest,
      action,
      'Close the paid service; return available payments'
    );
    expect(quoted.data.totalCredit).toBe('700000');
    expect(quoted.data.totalRefund).toBe('700000');
    expect(quoted.data.refundAllocations.map((x) => [x.invoiceId, x.amount])).toEqual([
      [closurePaidCharge, '200000'],
      [closureOriginal, '500000'],
    ]);
    expect(quoted.data.cancelInvoiceId).toBe(locale === 'en' ? closureUnpaidCharge : null);
    await financialSummary(page, quoted);
    await approveRiskConfirmation(page, locale, 'both');
    await inspect(page, dialog(page), '[role="dialog"]', confirm(page));
    await outcomeCapture(
      page,
      dialog(page).getByRole('region', { name: copy('paidResolutionReviewTitle'), exact: true }),
      info.outputPath(`consultation-closure-outcome-${locale}-${theme}.png`)
    );
    state.writeMode = 'held';
    state.shell.needsStepUp = true;
    await approveRiskConfirmation(page, locale, 'both');
    await confirm(page).click();
    await password(page);
    await expect.poll(() => !!state.heldWrite).toBe(true);
    const command = state.writes.at(-1)!;
    expect(command.body).toEqual({
      reason: quoted.data.reason,
      expectedReviewHash: quoted.hash,
      idempotencyKey: expect.stringMatching(commandKey),
    });
    await dialog(page).locator('form').dispatchEvent('submit');
    expect(state.writes).toHaveLength(2);
    const receipt = persist(command);
    expect(receipt).toEqual({
      requestId: closureRequest,
      status: action === 'cancel' ? 'cancelled' : 'rejected',
      cancelledInvoiceId: quoted.data.cancelInvoiceId,
      creditInvoiceIds: [expect.stringMatching(generatedId), expect.stringMatching(generatedId)],
      refundIds: [expect.stringMatching(generatedId), expect.stringMatching(generatedId)],
      financialReview: quoted,
    });
    if (locale === 'en') expect(state.invoices.get(closureUnpaidCharge)!.state).toBe('Cancelled');
    progressRefunds(closureRequest);
    await state.heldWrite!.fulfill({ json: { ...receipt, requestId: recoveryRequest } });
    await expect(retry(page)).toHaveText(resolutionCopy('retryCaptured'));
    await expect(dialog(page)).toHaveCount(0);
    await expect(reason(page)).toBeDisabled();
    await expect(reviewDecision(page)).toBeDisabled();
    await expect(reasonForm(page).getByRole('button')).toHaveCount(1);
    const reads = state.reads.length,
      previews = state.previews.length;
    const back = backToRequest(page);
    await expect(back).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByText(copy('filterStatus'), { exact: true })).toHaveCount(0);
    await back.dispatchEvent('click');
    await expect(page).toHaveURL(`/admin/consultations/${closureRequest}/decisions/${action}`);
    await refresh(page).dispatchEvent('click');
    await reviewDecision(page).dispatchEvent('click');
    expect(state.reads).toHaveLength(reads);
    expect(state.previews).toHaveLength(previews);
    expect(state.shell.previews).toEqual([]);
    expect(state.shell.writes).toEqual([]);
    for (const malformed of [
      { ...receipt, status: 'completed' },
      {
        ...receipt,
        creditInvoiceIds: [
          (receipt.creditInvoiceIds as string[])[0],
          (receipt.creditInvoiceIds as string[])[0],
        ],
      },
      {
        ...receipt,
        financialReview: {
          ...quoted,
          data: { ...quoted.data, refundAllocations: [...quoted.data.refundAllocations].reverse() },
        },
      },
    ]) {
      state.heldWrite = undefined;
      await retry(page).click();
      await approveRiskConfirmation(page, locale, 'both');
      await confirm(page).click();
      await expect.poll(() => !!state.heldWrite).toBe(true);
      await state.heldWrite!.fulfill({ json: jsonbOrder(malformed) });
      await expect(retry(page)).toBeEnabled();
      await expect(reason(page)).toBeDisabled();
    }
    state.writeMode = 'owned';
    await retry(page).click();
    await approveRiskConfirmation(page, locale, 'both');
    await confirm(page).click();
    await expect(cancel(page)).toBeEnabled();
    await cancel(page).click();
    await expect(retry(page)).toBeEnabled();
    state.writeMode = 'success';
    await retry(page).click();
    await approveRiskConfirmation(page, locale, 'both');
    await confirm(page).click();
    await expect(retry(page)).toHaveCount(0);
    await expect(reasonForm(page)).toHaveCount(0);
    await preservedCompanions(page);
    expect(state.writes.every((call) => call.raw === command.raw)).toBe(true);
    expect(state.writes.slice(1).every((call) => call.csrf === 'consultation-fee-rotated')).toBe(
      true
    );
    expect(state.previews).toHaveLength(previews);
    expect(state.shell.previews).toEqual([]);
    expect(state.shell.writes).toEqual([]);
    expect(state.effects).toBe(1);
    // An old private read denial cannot withdraw the new selected scope.
    state.holdDetail = true;
    await refresh(page).click();
    await expect.poll(() => !!state.heldDetail).toBe(true);
    const oldRead = state.heldDetail!;
    state.holdDetail = false;
    await chooseExternally(page, recoveryRequest, 'recover-refund');
    await expect(reason(page)).toBeVisible();
    await reason(page).fill('Fresh authorized recovery draft');
    await oldRead
      .fulfill({
        status: 403,
        json: {
          error: {
            code: ErrorCodes.AUTHZ_FORBIDDEN.code,
            correlationId: recoveryOriginal,
            message: 'PRIVATE_OLD_SCOPE',
          },
        },
      })
      .catch(() => {});
    await expect(reason(page)).toHaveValue('Fresh authorized recovery draft');
    state.previewMode = 'denied';
    await reviewDecision(page).click();
    await expect(reason(page)).toHaveCount(0);
    await expect(page.locator('main[data-area=admin]')).not.toContainText(
      'Fresh authorized recovery draft'
    );
    await expect(page.locator('main[data-area=admin]')).not.toContainText('PRIVATE_OLD_SCOPE');
  });
  test(`consultation uncovered credit recovery retains its exact original plan (${locale}, ${theme})`, async ({
    page,
  }, info) => {
    await page.clock.install();
    const { state, review, persist, progressRefunds } = await setupConsultationPaidResolution(
      page,
      locale
    );
    await page.goto(`/admin/consultations?requestId=${recoveryRequest}`);
    await companions(page);
    await openDecision(page, 'recover-refund');
    await reason(page).fill('x'.repeat(1001));
    await reviewDecision(page).click();
    await focusedError(reason(page));
    await reason(page).fill('  Recover the uncovered credit without closing service  ');
    state.previewMode = 'owned';
    await reviewDecision(page).click();
    await focusedError(reason(page));
    await preservedCompanions(page, 'recover-refund');
    await expect(reason(page)).toHaveValue(
      '  Recover the uncovered credit without closing service  '
    );
    await inspect(page, reasonForm(page), 'form:has(#consultation-reason)', reviewDecision(page));
    await fieldCapture(
      reason(page),
      info.outputPath(`consultation-recovery-fields-${locale}-${theme}.png`)
    );
    state.previewMode = 'success';
    await reviewDecision(page).click();
    await expect(dialog(page)).toContainText(copy('paidResolutionRecoveryOutcome'));
    const quoted = review(
      recoveryRequest,
      'recover_refund',
      'Recover the uncovered credit without closing service'
    );
    expect(quoted.data.totalCredit).toBe('0');
    expect(quoted.data.totalRefund).toBe('350000');
    expect(quoted.data.currentStatus).toBe('offer_accepted');
    expect(quoted.data.resultingStatus).toBe('offer_accepted');
    expect(quoted.data.cancelInvoiceId).toBeNull();
    expect(
      quoted.data.refundAllocations.map((x) => [x.invoiceId, x.amount, x.availableBefore])
    ).toEqual([
      [recoveryPaidCharge, '200000', '200000'],
      [recoveryOriginal, '150000', '450000'],
    ]);
    await financialSummary(page, quoted);
    await approveRiskConfirmation(page, locale, 'both');
    await inspect(page, dialog(page), '[role="dialog"]', confirm(page));
    await outcomeCapture(
      page,
      dialog(page).getByRole('region', { name: copy('paidResolutionReviewTitle'), exact: true }),
      info.outputPath(`consultation-recovery-outcome-${locale}-${theme}.png`)
    );
    state.writeMode = 'held';
    state.shell.needsStepUp = true;
    await approveRiskConfirmation(page, locale, 'both');
    await confirm(page).click();
    await password(page);
    await expect.poll(() => !!state.heldWrite).toBe(true);
    const command = state.writes.at(-1)!;
    expect(command.body).toEqual({
      reason: quoted.data.reason,
      expectedReviewHash: quoted.hash,
      idempotencyKey: expect.stringMatching(commandKey),
    });
    await dialog(page).locator('form').dispatchEvent('submit');
    expect(state.writes).toHaveLength(2);
    const receipt = persist(command);
    expect(receipt).toEqual({
      requestId: recoveryRequest,
      status: 'offer_accepted',
      refundIds: [expect.stringMatching(generatedId), expect.stringMatching(generatedId)],
      financialReview: quoted,
    });
    expect(receipt).not.toHaveProperty('creditInvoiceIds');
    expect(receipt).not.toHaveProperty('cancelledInvoiceId');
    progressRefunds(recoveryRequest);
    expect(state.rows[recoveryRequest]!.uncovered_credit).toBe('0');
    const held = state.heldWrite!;
    await page.clock.fastForward(15_001);
    await expect(retry(page)).toBeEnabled();
    await held.fulfill({ status: 503, json: {} }).catch(() => {});
    await expect(reason(page)).toBeDisabled();
    await expect(backToRequest(page)).toHaveAttribute('aria-disabled', 'true');
    await expect(reviewDecision(page)).toBeDisabled();
    await expect(reasonForm(page).getByRole('button')).toHaveCount(1);
    const reads = state.reads.length,
      previews = state.previews.length;
    await refresh(page).dispatchEvent('click');
    await backToRequest(page).dispatchEvent('click');
    await expect(page).toHaveURL(
      `/admin/consultations/${recoveryRequest}/decisions/recover-refund`
    );
    await reasonForm(page).dispatchEvent('submit');
    expect(state.reads).toHaveLength(reads);
    expect(state.previews).toHaveLength(previews);
    expect(state.shell.previews).toEqual([]);
    expect(state.shell.writes).toEqual([]);
    for (const malformed of [
      {
        ...receipt,
        refundIds: [(receipt.refundIds as string[])[0], (receipt.refundIds as string[])[0]],
      },
      {
        ...receipt,
        financialReview: { ...quoted, data: { ...quoted.data, totalCredit: '350000' } },
      },
      { ...receipt, status: 'cancelled' },
    ]) {
      state.heldWrite = undefined;
      await retry(page).click();
      await approveRiskConfirmation(page, locale, 'both');
      await confirm(page).click();
      await expect.poll(() => !!state.heldWrite).toBe(true);
      await state.heldWrite!.fulfill({ json: jsonbOrder(malformed) });
      await expect(retry(page)).toBeEnabled();
      await expect(reason(page)).toBeDisabled();
    }
    state.writeMode = 'rejected';
    await retry(page).click();
    await approveRiskConfirmation(page, locale, 'both');
    await confirm(page).click();
    await expect(cancel(page)).toBeEnabled();
    await cancel(page).click();
    await expect(retry(page)).toBeEnabled();
    state.writeMode = 'success';
    await retry(page).click();
    await approveRiskConfirmation(page, locale, 'both');
    await confirm(page).click();
    await expect(retry(page)).toHaveCount(0);
    await expect(reasonForm(page)).toHaveCount(0);
    await preservedCompanions(page);
    await expect(decisionLink(page, 'recover-refund')).toHaveCount(0);
    await expect(decisionLink(page, 'complete')).toBeVisible();
    expect(state.rows[recoveryRequest]!.status).toBe('offer_accepted');
    expect(state.effects).toBe(1);
    expect(state.writes.every((call) => call.raw === command.raw)).toBe(true);
    expect(state.writes.slice(1).every((call) => call.csrf === 'consultation-fee-rotated')).toBe(
      true
    );
    expect(state.previews).toHaveLength(previews);
    expect(state.shell.previews).toEqual([]);
    expect(state.shell.writes).toEqual([]);
    state.previewMode = 'held';
    await openDecision(page, 'cancel');
    await reason(page).fill('Old selected paid cancellation draft');
    await reviewDecision(page).click();
    await expect.poll(() => !!state.heldPreview).toBe(true);
    const oldPreview = state.heldPreview!;
    state.previewMode = 'success';
    await chooseExternally(page, closureRequest, locale === 'en' ? 'cancel' : 'reject');
    await expect(reason(page)).toBeVisible();
    await reason(page).fill('Current private closure draft');
    await oldPreview
      .fulfill({
        status: 404,
        json: {
          error: {
            code: ErrorCodes.NOT_FOUND_RESOURCE.code,
            correlationId: recoveryOriginal,
            message: 'PRIVATE_OLD_RESOLUTION',
          },
        },
      })
      .catch(() => {});
    await expect(reason(page)).toHaveValue('Current private closure draft');
    state.previewMode = 'missing';
    await reviewDecision(page).click();
    await expect(reason(page)).toHaveCount(0);
    await expect(page.locator('main[data-area=admin]')).not.toContainText(
      'Current private closure draft'
    );
    await expect(page.locator('main[data-area=admin]')).not.toContainText('PRIVATE_OLD_RESOLUTION');
  });
}
