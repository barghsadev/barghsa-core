import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import { t } from '@barghsa/i18n/app';
import { t as adminText } from '@barghsa/i18n/admin-ui';
import { test, expect } from './coverage-fixture';
import {
  correctionOrder,
  correctionProfile,
  correctionContract,
  correctionInvoice,
  correctionVersion,
  correctionProvince,
  correctionCity,
  correctionPeriodStart,
  correctionPeriodEnd,
  otherCorrectionOrder,
  correctionQuote,
  correctionDetail,
  correctionStaffReview,
  correctionStaffOrder,
  setupElectricityCorrectionForms,
} from './electricity-correction-form-fixture';

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
  for (const field of await form.locator('input,textarea,select,button').all()) {
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
  const staffText = (key: string) => adminText(`admin.electricityOrders.${key}`, locale);
  test(`electricity staff changes and address correction preserve captured commands (${locale}, ${theme})`, async ({
    page,
  }, info) => {
    test.setTimeout(60_000);
    const { state, persistCorrection } = await setupElectricityCorrectionForms(
      page,
      locale,
      theme === 'dark'
    );
    state.context = 'staff';
    const manifest = JSON.parse(
      await readFile(new URL('../dist/.vite/manifest.json', import.meta.url), 'utf8')
    );
    let releaseSchema!: () => void;
    const schemaHeld = new Promise<void>((resolve) => {
      releaseSchema = resolve;
    });
    await page.route(
      '**/' + manifest['src/lib/electricity-staff-reason-form-schemas.ts'].file,
      async (route) => {
        await schemaHeld;
        await route.continue();
      }
    );
    await page.goto(`/admin/electricity-orders?orderId=${correctionOrder}`);
    const staffForm = page.getByTestId('electricity-staff-reason-form');
    const reason = page.locator('#electricity-review-reason');
    const changes = page.getByRole('button', { name: staffText('request-changes'), exact: true });
    await expect(reason).toBeVisible();
    await expect(reason).not.toHaveAttribute('aria-invalid', 'true');
    await changes.click();
    await expect(changes).toBeDisabled();
    await changes.dispatchEvent('click');
    await changes.dispatchEvent('click');
    expect(state.staffPreviews).toEqual([]);
    releaseSchema();
    await focusedError(reason);
    expect(state.staffPreviews).toEqual([]);
    await reason.fill('  Captured <script> delivery correction  ');
    await changes.click();
    await focusedError(reason);
    expect(state.staffPreviews).toEqual([
      { action: 'request-changes', reason: 'Captured <script> delivery correction' },
    ]);
    await expect(reason).toHaveValue('  Captured <script> delivery correction  ');
    state.staffReviewMode = 'unsafe';
    await changes.click();
    await expect.poll(() => state.staffPreviews.length).toBe(2);
    await expect(staffForm).not.toContainText('PRIVATE_SERVER_VALIDATION_TEXT');
    await expect(changes).toBeEnabled();
    await inspectForm(page, staffForm, 'electricity-staff-reason-form');
    await staffForm.screenshot({
      path: info.outputPath(`electricity-staff-reason-${locale}-${theme}.png`),
    });

    // A late preview for another selection cannot publish its private draft.
    state.staffReviewMode = 'held';
    await changes.click();
    await expect.poll(() => !!state.staffPreview).toBe(true);
    const stalePreview = state.staffPreview!;
    const staleCommand = state.staffPreviews.at(-1)!;
    const staleOrder = structuredClone(state.staff);
    await page.getByRole('button', { name: /Other Correction Buyer/ }).click();
    await expect(
      page.locator('#admin-content dd').filter({ hasText: /^Other Correction Buyer$/ })
    ).toBeVisible();
    await expect(reason).toHaveValue('');
    await reason.fill('PRIVATE_NEW_SELECTION_REASON');
    await stalePreview.fulfill({ json: correctionStaffReview(staleOrder, staleCommand) });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(reason).toHaveValue('PRIVATE_NEW_SELECTION_REASON');
    await expect(page.locator('#admin-content')).not.toContainText(
      'Captured <script> delivery correction'
    );
    await page.getByRole('button', { name: new RegExp(correctionOrder) }).click();
    await expect(
      page.locator('#admin-content dd').filter({ hasText: /^Correction Buyer$/ })
    ).toBeVisible();
    await expect(reason).toHaveValue('');
    await reason.fill('  Captured <script> delivery correction  ');
    state.staffPreview = undefined;
    await changes.click();
    await expect.poll(() => !!state.staffPreview).toBe(true);
    const capturedPreview = state.staffPreviews.at(-1)!;
    const capturedPreviewCount = state.staffPreviews.length;
    await changes.dispatchEvent('click');
    await changes.dispatchEvent('click');
    expect(state.staffPreviews).toHaveLength(capturedPreviewCount);
    await state.staffPreview!.fulfill({
      json: correctionStaffReview(state.staff, capturedPreview),
    });
    let dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Captured <script> delivery correction');
    await dialog.locator('button[type=submit]').click();
    await expect.poll(() => !!state.staffWrite).toBe(true);
    const staffCommand = state.staffWrites[0]!;
    expect(staffCommand).toEqual({
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
      expectedVersionId: correctionVersion,
      expectedReviewHash: 'b'.repeat(64),
      reason: 'Captured <script> delivery correction',
    });
    await dialog.locator('form').dispatchEvent('submit');
    expect(state.staffWrites).toEqual([staffCommand]);
    await state.staffWrite!.fulfill({
      json: {
        orderId: otherCorrectionOrder,
        contractId: correctionContract,
        invoiceId: correctionInvoice,
        status: 'changes_requested',
        refundId: null,
      },
    });
    await expect(dialog).toHaveCount(0);
    await expect(reason).toHaveValue('  Captured <script> delivery correction  ');
    await expect(changes).toBeDisabled();
    const lane = page.getByRole('button', { name: staffText('conversationView'), exact: true });
    await expect(lane).toBeDisabled();
    await lane.dispatchEvent('click');
    await expect(reason).toHaveValue('  Captured <script> delivery correction  ');
    const staffPreviewCount = state.staffPreviews.length;
    await page
      .getByRole('button', { name: copy('electricity.staffReasonForm.retry'), exact: true })
      .click();
    dialog = page.getByRole('dialog');
    state.staffWriteMode = 'success';
    await dialog.locator('button[type=submit]').click();
    await expect(dialog).toHaveCount(0);
    expect(state.staffPreviews).toHaveLength(staffPreviewCount);
    expect(state.staffWrites).toEqual([staffCommand, staffCommand]);
    state.detail.timeline[0]!.reason = String(staffCommand.reason);

    state.context = 'customer';
    await page.goto(`/electricity/orders/${correctionOrder}`);
    const addressForm = page.getByTestId('electricity-address-correction-form');
    const revisionForm = page.getByTestId('electricity-revision-form');
    const address = page.locator('#correction-address');
    const postal = page.locator('#correction-postal');
    const note = page.locator('#correction-note');
    const submit = addressForm.getByRole('button', {
      name: copy('electricity.order.correction.submit'),
      exact: true,
    });
    await expect(note).toBeVisible();
    await postal.fill('123');
    await submit.click();
    await focusedError(postal);
    expect(state.addressWrites).toEqual([]);
    await postal.fill('1234567890');
    await submit.click();
    await focusedError(note);
    expect(state.addressWrites).toEqual([]);
    await address.fill('  Captured <img> Electricity Street  ');
    await note.fill('  Address updated after staff feedback  ');
    state.addressOwnedError = true;
    await submit.click();
    await focusedError(postal);
    await expect(address).toHaveValue('  Captured <img> Electricity Street  ');
    await expect(note).toHaveValue('  Address updated after staff feedback  ');
    await expect(addressForm).not.toContainText('PRIVATE_SERVER_VALIDATION_TEXT');
    await inspectForm(page, addressForm, 'electricity-address-correction-form');
    await addressForm.screenshot({
      path: info.outputPath(`electricity-address-correction-${locale}-${theme}.png`),
    });
    state.addressOwnedError = false;
    await postal.fill('1234567890');
    await submit.click();
    await expect.poll(() => !!state.addressWrite).toBe(true);
    const addressCommand = state.addressWrites.at(-1)!;
    expect(addressCommand).toEqual({
      fullAddress: 'Captured <img> Electricity Street',
      postalCode: '1234567890',
      responseNote: 'Address updated after staff feedback',
      expectedVersionId: correctionVersion,
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    await addressForm.dispatchEvent('submit');
    await revisionForm.dispatchEvent('submit');
    expect(state.addressWrites).toHaveLength(2);
    expect(state.quotePreviews).toEqual([]);
    await state.addressWrite!.fulfill({
      json: { orderId: otherCorrectionOrder, status: 'awaiting_staff_review' },
    });
    await expect(page.getByTestId('electricity-address-correction-retry')).toBeEnabled();
    await expect(submit).toBeDisabled();
    await expect(revisionForm.locator('button[type=submit]')).toBeDisabled();
    await expect(address).toHaveValue('  Captured <img> Electricity Street  ');
    await expect(note).toHaveValue('  Address updated after staff feedback  ');
    persistCorrection('address');
    state.addressWriteMode = 'success';
    await page.getByTestId('electricity-address-correction-retry').click();
    await expect(addressForm).toHaveCount(0);
    expect(state.addressWrites.slice(1)).toEqual([addressCommand, addressCommand]);
    await expect(page.locator('[data-slot=status-timeline]')).toContainText(
      'Address updated after staff feedback'
    );
    await expect(page.locator('body')).not.toContainText('PRIVATE_SERVER_VALIDATION_TEXT');
    await expect(
      page.locator('[data-slot=status-timeline] script,[data-slot=status-timeline] img')
    ).toHaveCount(0);
    // Adjacent rejection keeps the same authoritative review and receipt contract.
    state.context = 'staff';
    state.staff = {
      ...correctionStaffOrder(),
      versionId: state.detail.versionId,
      fullAddress: state.detail.fullAddress,
    };
    state.staffReviewMode = 'success';
    await page.goto(`/admin/electricity-orders?orderId=${correctionOrder}`);
    await reason.fill('  Final rejection reason  ');
    await page.getByRole('button', { name: staffText('reject'), exact: true }).click();
    dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Final rejection reason');
    await dialog.locator('button[type=submit]').click();
    await expect(dialog).toHaveCount(0);
    expect(state.staffWrites.at(-1)).toMatchObject({
      expectedVersionId: state.detail.versionId,
      expectedReviewHash: 'b'.repeat(64),
      reason: 'Final rejection reason',
    });
    await expect(page.locator('#admin-content')).toContainText(staffText('commercial.rejected'));
  });

  for (const advanced of [false, true]) {
    test(`electricity ${advanced ? 'advanced' : 'simple'} revision validates and retries one reviewed command (${locale}, ${theme})`, async ({
      page,
    }, info) => {
      const { state, persistCorrection } = await setupElectricityCorrectionForms(
        page,
        locale,
        theme === 'dark',
        advanced
      );
      await page.goto(`/electricity/orders/${correctionOrder}`);
      const form = page.getByTestId('electricity-revision-form');
      const region = form.locator('..');
      const addressForm = page.getByTestId('electricity-address-correction-form');
      const quantity = page.locator(advanced ? '#revision-thermal' : '#revision-quantity');
      const address = page.locator('#revision-address');
      const postal = page.locator('#revision-postal');
      const note = page.locator('#revision-note');
      const preview = form.getByRole('button', {
        name: copy('electricity.order.revision.preview'),
        exact: true,
      });
      await expect(note).toBeVisible();
      await expect(note).not.toHaveAttribute('aria-invalid', 'true');
      if (advanced) {
        await expect(
          page.getByLabel(copy('electricity.advanced.start'), { exact: true })
        ).toHaveAttribute('id', 'revision-start-date');
        await expect(
          page.getByLabel(copy('electricity.advanced.end'), { exact: true })
        ).toHaveAttribute('id', 'revision-end-date');
        const startClock = form.locator('fieldset').first();
        await expect(
          startClock.getByRole('combobox', { name: locale === 'fa' ? 'ساعت' : 'Hour', exact: true })
        ).toHaveValue(locale === 'fa' ? '0' : '12');
        await expect(
          startClock.getByRole('combobox', {
            name: locale === 'fa' ? 'دقیقه' : 'Minute',
            exact: true,
          })
        ).toHaveValue('0');
      }
      // Isolate each local error so focus follows its owned field.
      await note.fill('Quantity validation companion note');
      await quantity.fill('invalid');
      await preview.click();
      await focusedError(quantity);
      expect(state.quotePreviews).toEqual([]);
      await quantity.fill('10');
      await note.fill('');
      await preview.click();
      await focusedError(note);
      await address.fill('  Captured revision delivery  ');
      await note.fill('  Revised terms after staff feedback  ');
      await preview.click();
      await focusedError(quantity);
      expect(state.quotePreviews).toHaveLength(1);
      await expect(note).toHaveValue('  Revised terms after staff feedback  ');
      if (advanced) {
        await expect(page.locator('#revision-green')).toHaveCount(0);
        await expect(region).toContainText(copy('electricity.advanced.greenDerived'));
        expect(state.quotePreviews[0]).toMatchObject({
          startAt: correctionPeriodStart,
          endAt: correctionPeriodEnd,
          quantities: { thermal: '10', green: '0', free_market: '0', energy_saving: '0' },
        });
      } else {
        expect(state.quotePreviews[0]).toMatchObject({ period: 'next_week', totalKwh: '10' });
      }
      state.quoteMode = 'unsafe';
      await preview.click();
      await expect.poll(() => state.quotePreviews.length).toBe(2);
      await expect(preview).toBeEnabled();
      await expect(form).not.toContainText('PRIVATE_SERVER_VALIDATION_TEXT');
      await expect(form).not.toContainText('expectedVersionId');
      await expect(note).toHaveValue('  Revised terms after staff feedback  ');
      await inspectForm(page, form, 'electricity-revision-form');
      await form.screenshot({
        path: info.outputPath(
          `electricity-${advanced ? 'advanced' : 'simple'}-revision-${locale}-${theme}.png`
        ),
      });

      state.quoteMode = 'held';
      await preview.click();
      await expect.poll(() => !!state.quotePreview).toBe(true);
      const capturedPreview = state.quotePreviews.at(-1)!;
      const previewCount = state.quotePreviews.length;
      await form.dispatchEvent('submit');
      await form.dispatchEvent('submit');
      expect(state.quotePreviews).toHaveLength(previewCount);
      await state.quotePreview!.fulfill({ json: correctionQuote(advanced) });
      const confirm = region.getByRole('button', {
        name: copy('electricity.order.correction.submit'),
        exact: true,
      });
      await expect(confirm).toBeEnabled();
      await expect(region).toContainText(copy('electricity.order.revision.replacesInvoice'));
      await confirm.click();
      await expect.poll(() => !!state.revisionWrite).toBe(true);
      const command = state.revisionWrites[0]!;
      expect(command).toEqual({
        ...capturedPreview,
        address: {
          provinceId: correctionProvince,
          cityId: correctionCity,
          fullAddress: 'Captured revision delivery',
          postalCode: '1234567890',
        },
        responseNote: 'Revised terms after staff feedback',
        idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
        expectedQuoteDigest: 'a'.repeat(64),
      });
      expect(command).toMatchObject({
        profileId: correctionProfile,
        expectedVersionId: correctionVersion,
      });
      await confirm.dispatchEvent('click');
      await form.dispatchEvent('submit');
      await addressForm.dispatchEvent('submit');
      expect(state.revisionWrites).toEqual([command]);
      expect(state.quotePreviews).toHaveLength(previewCount);
      expect(state.addressWrites).toEqual([]);
      await state.revisionWrite!.fulfill({
        json: {
          orderId: correctionOrder,
          contractId: correctionContract,
          versionId: correctionVersion,
          status: 'awaiting_staff_review',
        },
      });
      const retry = page.getByTestId('electricity-revision-retry');
      await expect(retry).toBeEnabled();
      await expect(preview).toBeDisabled();
      await expect(addressForm.locator('button[type=submit]')).toBeDisabled();
      await expect(address).toHaveValue('  Captured revision delivery  ');
      await expect(postal).toHaveValue('1234567890');
      await expect(note).toHaveValue('  Revised terms after staff feedback  ');
      persistCorrection('revision');
      state.revisionWriteMode = 'success';
      await retry.click();
      await expect(form).toHaveCount(0);
      expect(state.revisionWrites).toEqual([command, command]);
      expect(state.quotePreviews).toHaveLength(previewCount);
      expect(state.addressWrites).toEqual([]);
      await expect(page.locator('[data-slot=status-timeline]')).toContainText(
        'Revised terms after staff feedback'
      );
      if (!advanced) {
        // Missing-resource authority clears both independent drafts and the reviewed quote.
        state.detail = correctionDetail(false);
        state.quoteMode = 'success';
        state.revisionWriteMode = 'denied';
        await page.reload();
        await note.fill('PRIVATE_WITHDRAWN_REVISION_DRAFT');
        await page.locator('#correction-note').fill('PRIVATE_WITHDRAWN_ADDRESS_DRAFT');
        await preview.click();
        await expect(confirm).toBeEnabled();
        await confirm.click();
        await expect(form).toHaveCount(0);
        await expect(addressForm).toHaveCount(0);
        await expect(page.locator('body')).not.toContainText('PRIVATE_WITHDRAWN_REVISION_DRAFT');
        await expect(page.locator('body')).not.toContainText('PRIVATE_WITHDRAWN_ADDRESS_DRAFT');
      }
    });
  }
}
