import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import { t } from '@barghsa/i18n/app';
import { t as adminText } from '@barghsa/i18n/admin-ui';
import { test, expect } from './coverage-fixture';
import {
  approvedIncrease,
  increaseDecisionReview,
  increaseRequest,
  increaseRequestId,
  increaseStaffId,
  increaseSigningReview,
  orderId,
  otherIncreaseRequestId,
  setupElectricityQuantityIncreaseForms,
  versionId,
} from './electricity-quantity-increase-form-fixture';

async function focusedError(field: Locator) {
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(field).toHaveAttribute('aria-describedby', /-description.*-message/);
}
async function inspectForm(page: Page, form: Locator, testId: string) {
  expect(
    (await new AxeBuilder({ page }).include(`[data-testid="${testId}"]`).analyze()).violations
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const field of await form.locator('input,textarea,button').all()) {
    const bounds = await field.boundingBox();
    if (bounds) {
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
    }
  }
}
for (const [locale, theme] of [
  ['en', 'light'],
  ['fa', 'dark'],
] as const) {
  const copy = (key: string) => t(key, locale);
  const staffText = (key: string) => adminText(`admin.electricityIncreases.${key}`, locale);
  test(`quantity request and adjacent signing retain exact attempts (${locale}, ${theme})`, async ({
    page,
  }, info) => {
    const state = await setupElectricityQuantityIncreaseForms(page, locale, theme === 'dark');
    const manifest = JSON.parse(
      await readFile(new URL('../dist/.vite/manifest.json', import.meta.url), 'utf8')
    );
    let releaseSchema!: () => void;
    const schemaHeld = new Promise<void>((resolve) => {
      releaseSchema = resolve;
    });
    await page.route(
      '**/' + manifest['src/lib/electricity-increase-form-schemas.ts'].file,
      async (route) => {
        await schemaHeld;
        await route.continue();
      }
    );
    await page.goto(`/electricity/orders/${orderId}`);
    const form = page.getByTestId('electricity-increase-form');
    const quantity = page.locator('#electricity-increase-kwh');
    const submit = form.getByRole('button', {
      name: copy('electricity.increase.submit'),
      exact: true,
    });
    await expect(quantity).toBeVisible();
    await expect(quantity).not.toHaveAttribute('aria-invalid', 'true');
    await submit.click();
    await expect(submit).toBeDisabled();
    await form.dispatchEvent('submit');
    await form.dispatchEvent('submit');
    expect(state.requestWrites).toEqual([]);
    releaseSchema();
    await focusedError(quantity);
    await quantity.fill('13');
    await submit.click();
    await focusedError(quantity);
    expect(state.requestWrites).toEqual([]);
    await quantity.fill(' 12 ');
    await submit.click();
    await focusedError(quantity);
    await expect(quantity).toHaveValue(' 12 ');
    expect(state.requestWrites).toHaveLength(1);
    expect(state.requestWrites[0]).toMatchObject({
      requestedKwh: '12',
      expectedVersionId: versionId,
    });
    await expect(form).not.toContainText('PRIVATE_SERVER_VALIDATION_TEXT');
    await expect(quantity).toHaveValue(' 12 ');
    await inspectForm(page, form, 'electricity-increase-form');
    await quantity.locator('..').screenshot({
      path: info.outputPath(`increase-quantity-${locale}-${theme}.png`),
    });

    state.requestMode = 'held';
    await submit.click();
    await expect.poll(() => !!state.requestRoute).toBe(true);
    const command = state.requestWrites.at(-1)!;
    expect(command).toEqual({
      requestedKwh: '12',
      expectedVersionId: versionId,
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    await form.dispatchEvent('submit');
    await submit.dispatchEvent('click');
    expect(state.requestWrites).toHaveLength(2);
    await state.requestRoute!.fulfill({
      status: 201,
      json: increaseRequest(otherIncreaseRequestId),
    });
    const retry = page.getByTestId('electricity-increase-retry');
    await expect(retry).toBeEnabled();
    await expect(submit).toBeDisabled();
    await expect(quantity).toHaveValue(' 12 ');
    const readsBefore = state.customerReads;
    const refresh = page.getByTestId('electricity-increase-refresh');
    await expect(refresh).toHaveCount(0);
    expect(state.customerReads).toBe(readsBefore);
    // Exact request replay returns the live row, which may have progressed to approval.
    state.request = approvedIncrease();
    state.requestMode = 'success';
    await retry.click();
    await expect(form).toHaveCount(0);
    expect(state.requestWrites.slice(1)).toEqual([command, command]);
    const sign = page.getByRole('button', { name: copy('electricity.increase.sign'), exact: true });
    await expect(sign).toBeDisabled();
    const consent = page.getByRole('checkbox', {
      name: copy('electricity.increase.agree'),
      exact: true,
    });
    await consent.check();
    await sign.click();
    await expect.poll(() => !!state.signRoute).toBe(true);
    const review = increaseSigningReview(state.request);
    const signCommand = state.signWrites[0]!;
    expect(signCommand).toEqual({
      expectedAmendmentSha256: state.request.amendmentSha256,
      expectedAdjustmentIrR: review.data.adjustmentIrR,
      expectedReviewHash: review.hash,
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    await sign.dispatchEvent('click');
    expect(state.signWrites).toEqual([signCommand]);
    await state.signRoute!.fulfill({ status: 201, json: state.request });
    const signRetry = page.getByTestId('electricity-increase-sign-retry');
    await expect(signRetry).toBeEnabled();
    await expect(sign).toBeDisabled();
    await expect(consent).toBeChecked();
    state.signMode = 'stepup';
    await signRetry.click();
    await expect(
      page.getByRole('link', { name: copy('electricity.increase.security'), exact: true })
    ).toBeVisible();
    await expect(consent).toBeChecked();
    await expect(signRetry).toBeEnabled();
    await expect(sign).toBeDisabled();
    state.signMode = 'success';
    await signRetry.click();
    await expect(sign).toHaveCount(0);
    expect(state.signWrites).toEqual([signCommand, signCommand, signCommand]);
    await expect(page.locator('body')).not.toContainText('PRIVATE_SERVER_VALIDATION_TEXT');
    await expect(
      page.locator(`a[href="/invoices/${state.request!.adjustmentInvoiceId}"]`)
    ).toBeVisible();
    expect(state.request!.status).toBe('awaiting_effective_date');
    expect(state.request!.contractState).toBe('Active');
  });

  test(`staff increase date and rejection forms preserve bound decisions (${locale}, ${theme})`, async ({
    page,
  }, info) => {
    const state = await setupElectricityQuantityIncreaseForms(page, locale, theme === 'dark');
    state.auth.context = 'staff';
    state.auth.actor = increaseStaffId;
    state.decisionMode = 'conflict';
    await page.goto('/admin/electricity-increases');
    let approveForm = page.getByTestId('electricity-increase-approve-form').first();
    let rejectForm = page.getByTestId('electricity-increase-reject-form').first();
    const date = page.locator(`#increase-effective-${increaseRequestId}`);
    await date.fill('2026-10-13T12:00');
    const approve = approveForm.getByRole('button', { name: staffText('approve'), exact: true });
    await approve.click();
    await expect(page.getByRole('alert')).toContainText(staffText('reviewError'));
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(date).not.toHaveAttribute('aria-invalid', 'true');
    await expect(date).toHaveValue('2026-10-13T12:00');
    expect(state.decisionPreviews).toHaveLength(1);
    expect(state.decisionPreviews[0]!.body).toEqual({
      effectiveFrom: await page.evaluate(() => new Date('2026-10-13T12:00').toISOString()),
    });
    await expect(rejectForm.locator('input,textarea')).toHaveValue('');
    await expect(approveForm).not.toContainText('PRIVATE_SERVER_VALIDATION_TEXT');
    await inspectForm(page, approveForm, 'electricity-increase-approve-form');
    await date
      .locator('..')
      .screenshot({ path: info.outputPath(`increase-date-${locale}-${theme}.png`) });

    // Editing during a read-only preview fences its old result and keeps the new date.
    state.decisionMode = 'held';
    await date.fill('2026-10-09T12:00');
    await approve.click();
    await expect.poll(() => !!state.decisionRoute).toBe(true);
    const staleRoute = state.decisionRoute!;
    const stalePreview = state.decisionPreviews.at(-1)!;
    await date.fill('2026-10-10T12:00');
    await staleRoute.fulfill({
      json: increaseDecisionReview(state.rows[0]!, 'approve', stalePreview.body),
    });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(approve).toBeEnabled();
    await expect(date).toHaveValue('2026-10-10T12:00');
    state.decisionRoute = undefined;
    await approve.click();
    await expect.poll(() => !!state.decisionRoute).toBe(true);
    const capturedPreview = state.decisionPreviews.at(-1)!;
    const previewCount = state.decisionPreviews.length;
    await approveForm.dispatchEvent('submit');
    await approve.dispatchEvent('click');
    expect(state.decisionPreviews).toHaveLength(previewCount);
    await state.decisionRoute!.fulfill({
      json: increaseDecisionReview(state.rows[0]!, 'approve', capturedPreview.body),
    });
    let dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(staffText('reviewTitle'));
    await dialog.locator('button[type=submit]').click();
    await expect.poll(() => !!state.decisionWriteRoute).toBe(true);
    const approvalCommand = state.decisionWrites[0]!;
    expect(approvalCommand).toEqual({
      id: increaseRequestId,
      action: 'approve',
      body: {
        effectiveFrom: capturedPreview.body.effectiveFrom,
        expectedReviewHash: 'a'.repeat(64),
        idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
      },
    });
    await dialog.locator('form').dispatchEvent('submit');
    expect(state.decisionWrites).toEqual([approvalCommand]);
    await state.decisionWriteRoute!.fulfill({ status: 201, json: {} });
    await expect(dialog).toHaveCount(0);
    const retry = page.getByRole('button', {
      name: copy('electricity.increaseDecisionForm.retryCaptured'),
      exact: true,
    });
    await expect(retry).toBeEnabled();
    await expect(date).toHaveValue('2026-10-10T12:00');
    const refresh = page.getByRole('button', { name: staffText('refresh'), exact: true });
    await expect(refresh).toBeDisabled();
    const expired = page.getByRole('button', { name: staffText('expiredTab'), exact: true });
    await expect(expired).toBeDisabled();
    await expired.dispatchEvent('click');
    await expect(date).toHaveValue('2026-10-10T12:00');
    state.decisionWriteMode = 'success';
    await retry.click();
    dialog = page.getByRole('dialog');
    await dialog.locator('button[type=submit]').click();
    await expect(dialog).toHaveCount(0);
    await expect(date).toHaveCount(0);
    expect(state.decisionPreviews).toHaveLength(previewCount);
    expect(state.decisionWrites).toEqual([approvalCommand, approvalCommand]);

    approveForm = page.getByTestId('electricity-increase-approve-form').first();
    rejectForm = page.getByTestId('electricity-increase-reject-form').first();
    const reason = page.locator(`#increase-reason-${otherIncreaseRequestId}`);
    const reject = rejectForm.getByRole('button', { name: staffText('reject'), exact: true });
    await reject.click();
    await focusedError(reason);
    expect(state.decisionPreviews).toHaveLength(previewCount);
    await reason.fill('  Rejection <script> explanation  ');
    state.decisionMode = 'owned';
    await reject.click();
    await focusedError(reason);
    await expect(reason).toHaveValue('  Rejection <script> explanation  ');
    await expect(rejectForm).not.toContainText('PRIVATE_SERVER_VALIDATION_TEXT');
    await inspectForm(page, rejectForm, 'electricity-increase-reject-form');
    await reason
      .locator('..')
      .screenshot({ path: info.outputPath(`increase-reason-${locale}-${theme}.png`) });
    state.decisionMode = 'success';
    await reject.click();
    dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Rejection <script> explanation');
    await expect(dialog.locator('script')).toHaveCount(0);
    await dialog.locator('button[type=submit]').click();
    await expect(dialog).toHaveCount(0);
    await expect(reason).toHaveCount(0);
    expect(state.decisionWrites.at(-1)).toMatchObject({
      id: otherIncreaseRequestId,
      action: 'reject',
      body: {
        reason: 'Rejection <script> explanation',
        expectedReviewHash: 'a'.repeat(64),
      },
    });
    // A fresh denied queue read withdraws every retained private row/draft.
    state.rows = [increaseRequest()];
    await refresh.click();
    await page.locator(`#increase-reason-${increaseRequestId}`).fill('PRIVATE_WITHDRAWN_REASON');
    state.queueDenied = true;
    await refresh.click();
    await expect(page.getByTestId('electricity-increase-reject-form')).toHaveCount(0);
    await expect(page.locator('#admin-content')).not.toContainText('PRIVATE_WITHDRAWN_REASON');
    await expect(page.locator('#admin-content')).toContainText(staffText('forbidden'));
  });
}
