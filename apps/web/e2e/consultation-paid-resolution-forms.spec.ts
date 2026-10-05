import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import type { ConsultationPaidResolutionReview } from '@barghsa/shared/finance';
import { ErrorCodes } from '@barghsa/shared/errors';
import { t } from '@barghsa/i18n/app';
import { tConsultation } from '@barghsa/i18n/consultation';
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
  const manifest = JSON.parse(
    await readFile(new URL('../dist/.vite/manifest.json', import.meta.url), 'utf8')
  );
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
  const resolutionCopy = (key: string) => tConsultationResolution(key, locale);
  const reason = (page: Page) => page.locator('#consultation-reason');
  const reasonForm = (page: Page) => reason(page).locator('xpath=ancestor::form');
  const feeForm = (page: Page) => page.getByTestId('consultation-fee-form');
  const dialog = (page: Page) => page.getByRole('dialog');
  const confirm = (page: Page) => dialog(page).locator('button[type=submit]');
  const cancel = (page: Page) =>
    dialog(page).getByRole('button', { name: t('team.cancel', locale), exact: true });
  const retry = (page: Page) => page.getByTestId('consultation-resolution-retry');
  const button = (page: Page, key: string) =>
    reasonForm(page).getByRole('button', { name: copy(key), exact: true });
  const refresh = (page: Page) =>
    page.getByRole('button', { name: copy('refresh'), exact: true }).first();
  async function companions(page: Page) {
    await page.locator('#consultation-team').selectOption('Operations');
    if (await feeForm(page).count()) {
      await expect(page.locator('#consultation-valid-until')).toBeEnabled();
      await page.locator('#consultation-fee').fill('680000');
      await page.locator('#consultation-offer-reason').fill('  Independent fee adjustment draft  ');
      await page.locator('#consultation-valid-until').fill('2030-02-01T12:00');
    }
  }
  async function preservedCompanions(page: Page) {
    await expect(page.locator('#consultation-team')).toHaveValue('Operations');
    if (await feeForm(page).count()) {
      await expect(page.locator('#consultation-fee')).toHaveValue('680000');
      await expect(page.locator('#consultation-offer-reason')).toHaveValue(
        '  Independent fee adjustment draft  '
      );
      await expect(page.locator('#consultation-valid-until')).toHaveValue('2030-02-01T12:00');
    }
  }
  async function password(page: Page) {
    const field = dialog(page).getByLabel(t('team.password', locale), { exact: true });
    await expect(field).toBeVisible();
    await field.fill('Consultation-resolution-proof-42!');
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
    await expect(reason(page)).toBeVisible();
    // Native focus/blur + companion edits precede duplicate held validation.
    await reason(page).focus();
    await reason(page).fill('x'.repeat(1001));
    await companions(page);
    await button(page, action).click();
    await expect(button(page, action)).toBeDisabled();
    await button(page, action).dispatchEvent('click');
    expect(state.previews).toEqual([]);
    release();
    await focusedError(reason(page));
    await preservedCompanions(page);
    await reason(page).fill('  Close the paid service; return available payments  ');
    state.previewMode = 'owned';
    await button(page, action).click();
    await focusedError(reason(page));
    await expect(reason(page)).toHaveValue('  Close the paid service; return available payments  ');
    await expect(reasonForm(page)).not.toContainText('PRIVATE_RESOLUTION_SERVER_TEXT');
    await inspect(page, reasonForm(page), 'form:has(#consultation-reason)', button(page, action));
    await fieldCapture(
      reason(page),
      info.outputPath(`consultation-closure-fields-${locale}-${theme}.png`)
    );
    expect(state.previews.at(-1)!.body).toEqual({
      action,
      reason: 'Close the paid service; return available payments',
    });
    state.previewMode = 'mixed';
    await button(page, action).click();
    await expect(page.locator('#admin-content').getByRole('alert')).toContainText(
      copy('loadError')
    );
    await expect(reason(page)).not.toHaveAttribute('aria-invalid', 'true');
    state.previewMode = 'foreign';
    const foreignPreviewCount = state.previews.length + 1;
    await button(page, action).click();
    await expect.poll(() => state.previews.length).toBe(foreignPreviewCount);
    await expect(button(page, action)).toBeEnabled();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.locator('#admin-content')).not.toContainText(
      'PRIVATE_RESOLUTION_SERVER_TEXT'
    );
    state.previewMode = 'success';
    await button(page, action).click();
    await expect(dialog(page)).toContainText(copy('paidResolutionCloseOutcome'));
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
    await inspect(page, dialog(page), '[role="dialog"]', confirm(page));
    await outcomeCapture(
      page,
      dialog(page).getByRole('region', { name: copy('paidResolutionReviewTitle'), exact: true }),
      info.outputPath(`consultation-closure-outcome-${locale}-${theme}.png`)
    );
    state.writeMode = 'held';
    state.shell.needsStepUp = true;
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
    await expect(
      page.getByRole('button', { name: copy('assignSelf'), exact: true })
    ).toBeDisabled();
    await expect(button(page, action === 'cancel' ? 'reject' : 'cancel')).toBeDisabled();
    if (await feeForm(page).count())
      await expect(feeForm(page).locator('button[type=submit]')).toBeDisabled();
    const reads = state.reads.length,
      previews = state.previews.length;
    const otherRow = page.getByRole('button', { name: /Refund recovery buyer/ });
    await expect(otherRow).toBeDisabled();
    await expect(
      page.getByText(copy('filterStatus'), { exact: true }).locator('..').locator('select')
    ).toBeDisabled();
    await otherRow.dispatchEvent('click');
    await refresh(page).dispatchEvent('click');
    await button(page, action).dispatchEvent('click');
    if (await feeForm(page).count()) await feeForm(page).dispatchEvent('submit');
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
      await confirm(page).click();
      await expect.poll(() => !!state.heldWrite).toBe(true);
      await state.heldWrite!.fulfill({ json: jsonbOrder(malformed) });
      await expect(retry(page)).toBeEnabled();
      await expect(reason(page)).toBeDisabled();
    }
    state.writeMode = 'owned';
    await retry(page).click();
    await confirm(page).click();
    await expect(cancel(page)).toBeEnabled();
    await cancel(page).click();
    await expect(retry(page)).toBeEnabled();
    state.writeMode = 'success';
    await retry(page).click();
    await confirm(page).click();
    await expect(retry(page)).toHaveCount(0);
    await expect(reason(page)).toHaveValue('');
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
    await chooseExternally(page, recoveryRequest);
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
    await button(page, 'recoverRefund').click();
    await expect(reason(page)).toHaveCount(0);
    await expect(page.locator('#admin-content')).not.toContainText(
      'Fresh authorized recovery draft'
    );
    await expect(page.locator('#admin-content')).not.toContainText('PRIVATE_OLD_SCOPE');
  });
  test(`consultation uncovered credit recovery retains its exact original plan (${locale}, ${theme})`, async ({
    page,
  }, info) => {
    const { state, review, persist, progressRefunds } = await setupConsultationPaidResolution(
      page,
      locale
    );
    await page.goto(`/admin/consultations?requestId=${recoveryRequest}`);
    await expect(reason(page)).toBeVisible();
    await companions(page);
    await reason(page).fill('x'.repeat(1001));
    await button(page, 'recoverRefund').click();
    await focusedError(reason(page));
    await reason(page).fill('  Recover the uncovered credit without closing service  ');
    state.previewMode = 'owned';
    await button(page, 'recoverRefund').click();
    await focusedError(reason(page));
    await preservedCompanions(page);
    await inspect(
      page,
      reasonForm(page),
      'form:has(#consultation-reason)',
      button(page, 'recoverRefund')
    );
    await fieldCapture(
      reason(page),
      info.outputPath(`consultation-recovery-fields-${locale}-${theme}.png`)
    );
    state.previewMode = 'success';
    await button(page, 'recoverRefund').click();
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
    await inspect(page, dialog(page), '[role="dialog"]', confirm(page));
    await outcomeCapture(
      page,
      dialog(page).getByRole('region', { name: copy('paidResolutionReviewTitle'), exact: true }),
      info.outputPath(`consultation-recovery-outcome-${locale}-${theme}.png`)
    );
    state.writeMode = 'held';
    state.shell.needsStepUp = true;
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
    await state.heldWrite!.fulfill({ status: 503, json: {} });
    await expect(retry(page)).toBeEnabled();
    await expect(reason(page)).toBeDisabled();
    await expect(feeForm(page).locator('button[type=submit]')).toBeDisabled();
    await expect(button(page, 'complete')).toBeDisabled();
    await expect(button(page, 'cancel')).toBeDisabled();
    await expect(
      page.getByRole('button', { name: copy('assignSelf'), exact: true })
    ).toBeDisabled();
    const reads = state.reads.length,
      previews = state.previews.length;
    await refresh(page).dispatchEvent('click');
    await feeForm(page).dispatchEvent('submit');
    await button(page, 'complete').dispatchEvent('click');
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
      await confirm(page).click();
      await expect.poll(() => !!state.heldWrite).toBe(true);
      await state.heldWrite!.fulfill({ json: jsonbOrder(malformed) });
      await expect(retry(page)).toBeEnabled();
      await expect(reason(page)).toBeDisabled();
    }
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
    await expect(reason(page)).toHaveValue('');
    await preservedCompanions(page);
    await expect(button(page, 'recoverRefund')).toHaveCount(0);
    await expect(button(page, 'complete')).toBeEnabled();
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
    await reason(page).fill('Old selected paid cancellation draft');
    await button(page, 'cancel').click();
    await expect.poll(() => !!state.heldPreview).toBe(true);
    const oldPreview = state.heldPreview!;
    state.previewMode = 'success';
    await chooseExternally(page, closureRequest);
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
    await button(page, locale === 'en' ? 'cancel' : 'reject').click();
    await expect(reason(page)).toHaveCount(0);
    await expect(page.locator('#admin-content')).not.toContainText('Current private closure draft');
    await expect(page.locator('#admin-content')).not.toContainText('PRIVATE_OLD_RESOLUTION');
  });
}
