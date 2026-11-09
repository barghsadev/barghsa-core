import type { Locator, Page, Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './coverage-fixture';
import { t } from '@barghsa/i18n/app';
import { tSolar } from '@barghsa/i18n/solar';
import { postalReceipt, setupSolarPostalForms } from './solar-postal-form-fixture';
import { approveRiskConfirmation } from './confirmation-fixture';
import { checkRoutePresentation } from './route-presentation';

test.use({ viewport: { width: 390, height: 844 } });
const settings = [
  ['en', 'light'],
  ['fa', 'dark'],
] as const;

async function focusedError(field: Locator) {
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(field).toHaveAttribute('aria-describedby', /-message/);
}
async function inspectForm(page: Page, scope: Locator, selector: string) {
  expect((await new AxeBuilder({ page }).include(selector).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const field of await scope.locator('input,textarea,select,button').all()) {
    const bounds = await field.boundingBox();
    if (bounds) {
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(391);
    }
  }
}

for (const [locale, theme] of settings) {
  const copy = (key: string) => tSolar(key, locale);
  test(`solar postal receipt images announce loading, failure and an empty retry (${locale}, ${theme})`, async ({
    page,
  }, info) => {
    const { state, firstSolar } = await setupSolarPostalForms(page, locale, theme === 'dark', true);
    let firstRead: Route | undefined;
    let reads = 0;
    await page.route(
      (url) =>
        url.pathname === '/api/documents' &&
        url.searchParams.get('businessRecordId') === firstSolar &&
        url.searchParams.get('category') === 'image',
      async (route) => {
        if (++reads === 1) firstRead = route;
        else await route.fulfill({ json: { documents: [], nextBefore: null } });
      }
    );
    await page.goto(`/solar/requests/${firstSolar}`);
    const form = page.getByRole('group', { name: copy('postalShipment'), exact: true });
    const loading = form.getByText(copy('postalReceiptLoading'), { exact: true });
    const empty = form.getByText(copy('postalReceiptEmpty'), { exact: true });
    const courier = form.getByLabel(copy('postalCourier'), { exact: true });
    await expect(loading).toBeVisible();
    await expect(empty).toHaveCount(0);
    await courier.fill('  Unsent postal draft  ');
    await expect.poll(() => Boolean(firstRead)).toBe(true);
    if (locale === 'fa' && info.project.name === 'mobile-safari') {
      await form.screenshot({ path: info.outputPath('solar-receipt-images-loading.png') });
    }
    await firstRead!.fulfill({ status: 503, json: {} });
    const error = form.getByRole('alert').filter({ hasText: copy('postalReceiptLoadError') });
    await expect(error).toBeVisible();
    await expect(loading).toHaveCount(0);
    await expect(empty).toHaveCount(0);
    const postalReads = state.customerReads.length;
    const retry = error.getByRole('button', { name: copy('retry'), exact: true });
    await retry.focus();
    await retry.press('Enter');
    await expect(empty).toBeVisible();
    await expect(error).toHaveCount(0);
    await expect(courier).toHaveValue('  Unsent postal draft  ');
    expect(reads).toBe(2);
    expect(state.customerReads).toHaveLength(postalReads);
    expect(state.shipmentWrites).toEqual([]);
  });

  test(`solar postal customer form retains captured shipment and recovers by fresh read (${locale}, ${theme})`, async ({
    page,
  }, info) => {
    const { state, persistShipment, customerState, firstSolar, olderSolar } =
      await setupSolarPostalForms(page, locale, theme === 'dark', true);
    await page.goto(`/solar/requests/${firstSolar}`);
    const postal = page.getByRole('region', { name: copy('postalStage'), exact: true });
    const form = postal.getByRole('group', { name: copy('postalShipment'), exact: true });
    const courier = form.getByLabel(copy('postalCourier'), { exact: true });
    const tracking = form.getByLabel(copy('postalTracking'), { exact: true });
    const date = form.getByLabel(copy('postalSendDate'), { exact: true });
    const receipt = form.getByLabel(copy('postalReceipt'), { exact: true });
    const submit = form.getByRole('button', { name: copy('postalSubmit'), exact: true });
    const reload = postal.getByRole('button', { name: copy('postalTrackingReload'), exact: true });
    for (const field of [courier, tracking, date]) {
      await expect(field).toHaveAttribute('aria-required', 'true');
    }
    await expect(receipt).not.toHaveAttribute('aria-required', 'true');
    await expect(receipt).not.toHaveAttribute('required');
    await courier.fill('C'.repeat(101));
    await tracking.fill('T'.repeat(201));
    await date.fill('2026-09-23');
    await submit.click();
    await focusedError(courier);
    expect(state.shipmentWrites).toEqual([]);
    await courier.fill('C'.repeat(100));
    await tracking.fill('T'.repeat(200));
    await submit.click();
    await focusedError(tracking);
    await expect(courier).toHaveValue('C'.repeat(100));
    await expect(tracking).toHaveValue('T'.repeat(200));
    await expect(date).toHaveValue('2026-09-23');
    expect(state.shipmentWrites).toEqual([
      { courier: 'C'.repeat(100), trackingNumber: 'T'.repeat(200), sendDate: '2026-09-23' },
    ]);

    await courier.fill('  Captured courier  ');
    await tracking.fill('  CAPTURED-TRACKING  ');
    await receipt.selectOption(postalReceipt);
    await inspectForm(page, form, '[aria-label="' + copy('postalStage') + '"]');
    await checkRoutePresentation(page, info, locale);
    await expect(tracking).toHaveValue('  CAPTURED-TRACKING  ');
    if (locale === 'en' && info.project.name === 'chromium')
      await postal.screenshot({ path: info.outputPath('solar-postal-customer-en-light.png') });
    const captured = {
      courier: 'Captured courier',
      trackingNumber: 'CAPTURED-TRACKING',
      sendDate: '2026-09-23',
      receiptImageId: postalReceipt,
    };
    state.shipmentMode = 'held';
    await submit.click();
    await expect.poll(() => !!state.shipment).toBe(true);
    await expect(submit).toBeDisabled();
    await expect(courier).toBeDisabled();
    await expect(tracking).toBeDisabled();
    await form.locator('form').dispatchEvent('submit');
    await form.locator('form').dispatchEvent('submit');
    expect(state.shipmentWrites).toHaveLength(2);
    expect(state.shipmentWrites[1]).toEqual(captured);
    persistShipment();
    await state.shipment!.fulfill({ status: 503, json: {} });
    await expect(postal.getByRole('alert').first()).toBeVisible();
    await expect(reload).toBeEnabled();
    await expect(submit).toBeDisabled();
    await expect(courier).toHaveValue('  Captured courier  ');
    await expect(tracking).toHaveValue('  CAPTURED-TRACKING  ');
    state.customerReadMode = 'mismatch';
    const beforeRecovery = state.customerReads.length;
    await reload.click();
    await expect.poll(() => state.customerReads.length).toBeGreaterThan(beforeRecovery);
    await expect(postal.getByRole('alert').first()).toBeVisible();
    await expect(submit).toBeDisabled();
    await expect(tracking).toHaveValue('  CAPTURED-TRACKING  ');
    expect(state.shipmentWrites).toHaveLength(2);
    state.customerReadMode = 'success';
    await reload.click();
    await expect(form).toHaveCount(0);
    await expect(postal).toContainText(captured.courier);
    await expect(postal).toContainText(captured.trackingNumber);
    expect(state.shipmentWrites).toHaveLength(2);

    // A read from the old request cannot overwrite a new request's private draft.
    state.customerReadMode = 'held';
    await reload.click();
    await expect.poll(() => !!state.customerRead).toBe(true);
    state.customerReadMode = 'success';
    await page.goto(`/solar/requests/${olderSolar}`);
    await expect(courier).toBeVisible();
    await expect(courier).toHaveValue('');
    await courier.fill('PRIVATE_NEW_SCOPE_DRAFT');
    await state.customerRead!.fulfill({
      json: {
        ...customerState(firstSolar),
        postal: { ...customerState(firstSolar).postal, courier: 'PRIVATE_OLD_SCOPE_COURIER' },
      },
    });
    await expect(courier).toHaveValue('PRIVATE_NEW_SCOPE_DRAFT');
    await expect(postal).not.toContainText('PRIVATE_OLD_SCOPE_COURIER');
    state.customerReadMode = 'denied';
    await reload.click();
    await expect(postal.getByRole('alert').first()).toBeVisible();
    await expect(courier).toHaveCount(0);
    await expect(postal).not.toContainText('Original postal guidance');
    await expect(postal).not.toContainText('راهنمای ارسال اصل مدارک');
    await expect(postal).not.toContainText('PRIVATE_NEW_SCOPE_DRAFT');
    await expect(postal).not.toContainText(captured.trackingNumber);
    expect(state.shipmentWrites).toHaveLength(2);
  });

  test(`solar postal staff forms keep independent drafts through receipt recovery and protected decisions (${locale}, ${theme})`, async ({
    page,
  }, info) => {
    const { state, finalReview } = await setupSolarPostalForms(page, locale, theme === 'dark');
    await page.goto('/admin/solar-postal');
    await page.getByRole('button', { name: /First solar buyer/ }).click();
    const reason = page.locator('#solar-postal-reason');
    await expect(reason).not.toHaveAttribute('aria-required', 'true');
    const guidance = page.getByRole('group', {
      name: copy('postalGuidance'),
      exact: true,
      includeHidden: true,
    });
    const en = guidance.getByLabel(copy('postalGuidance_en'), { exact: true });
    const fa = guidance.getByLabel(copy('postalGuidance_fa'), { exact: true });
    const originalsFa = guidance.getByLabel(copy('postalOriginalsFa'), { exact: true });
    const originalsEn = guidance.getByLabel(copy('postalOriginalsEn'), { exact: true });
    const address = guidance.getByLabel(copy('postalGuidance_destinationAddress'), { exact: true });
    const contact = guidance.getByLabel(copy('postalGuidance_contactDetails'), { exact: true });
    const save = guidance.getByRole('button', { name: copy('postalSaveGuidance'), exact: true });
    for (const field of [fa, en]) await expect(field).toHaveAttribute('aria-required', 'true');
    for (const field of [originalsFa, originalsEn, address, contact])
      await expect(field).not.toHaveAttribute('aria-required', 'true');
    const reload = page.locator('#solar-postal-guidance-reload');
    await reason.fill('Independent postal issue draft');
    await en.fill('  Captured postal guidance  ');
    await fa.fill('  راهنمای جدید ارسال مدارک  ');
    await address.fill('  Destination draft  ');
    await contact.fill('  Contact draft  ');
    await originalsFa.fill('اصل اول\nاصل دوم');
    await originalsEn.fill('First original');
    await save.click();
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.id))
      .toMatch(/^solar-postal-guidance-originals-(fa|en)$/);
    expect(state.guidanceWrites).toEqual([]);
    await expect(reason).toHaveValue('Independent postal issue draft');
    await originalsEn.fill('First original\nSecond original');
    await save.click();
    let dialog = page.getByRole('dialog', { name: copy('postalSaveGuidance'), exact: true });
    await dialog.locator('button[type=submit]').click();
    await expect(dialog).toHaveCount(0);
    await focusedError(originalsEn);
    await expect(reason).toHaveValue('Independent postal issue draft');
    await expect(en).toHaveValue('  Captured postal guidance  ');
    const capturedGuidance = {
      fa: 'راهنمای جدید ارسال مدارک',
      en: 'Captured postal guidance',
      destinationAddress: 'Destination draft',
      contactDetails: 'Contact draft',
      originals: [
        { fa: 'اصل اول', en: 'First original' },
        { fa: 'اصل دوم', en: 'Second original' },
      ],
    };
    expect(state.guidanceWrites).toEqual([capturedGuidance]);
    state.guidanceMode = 'unsafe';
    await save.click();
    dialog = page.getByRole('dialog', { name: copy('postalSaveGuidance'), exact: true });
    await dialog.locator('button[type=submit]').click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(dialog).not.toContainText('PRIVATE_REVIEW_HASH');
    await expect(originalsEn).not.toHaveAttribute('aria-invalid', 'true');
    let cancel = dialog.getByRole('button', { name: t('team.cancel', locale), exact: true });
    await expect(cancel).toBeEnabled();
    await cancel.click();
    await expect(dialog).toHaveCount(0);
    state.guidanceMode = 'mismatch';
    await save.click();
    dialog = page.getByRole('dialog', { name: copy('postalSaveGuidance'), exact: true });
    await dialog.locator('button[type=submit]').click();
    cancel = dialog.getByRole('button', { name: t('team.cancel', locale), exact: true });
    await expect(cancel).toBeEnabled();
    await expect(dialog.locator('button[type=submit]')).toBeDisabled();
    const uncertainWrites = state.guidanceWrites.length;
    await dialog.locator('form').dispatchEvent('submit');
    expect(state.guidanceWrites).toHaveLength(uncertainWrites);
    await cancel.click();
    await expect(dialog).toHaveCount(0);
    await expect(save).toBeDisabled();
    await expect(en).toHaveValue('  Captured postal guidance  ');
    await expect(reason).toHaveValue('Independent postal issue draft');
    state.guidanceReadMode = 'unavailable';
    const beforeReload = state.guidanceReads;
    await reload.click();
    await expect.poll(() => state.guidanceReads).toBeGreaterThan(beforeReload);
    await expect(save).toBeDisabled();
    await expect(en).toHaveValue('  Captured postal guidance  ');
    state.guidanceReadMode = 'success';
    await reload.click();
    await expect(save).toBeEnabled();
    expect(state.guidanceWrites).toHaveLength(uncertainWrites);
    await expect(reason).toHaveValue('Independent postal issue draft');
    state.guidanceMode = 'success';
    const beforeGuidanceSave = state.queueReads;
    await save.click();
    dialog = page.getByRole('dialog', { name: copy('postalSaveGuidance'), exact: true });
    await dialog.locator('button[type=submit]').click();
    await expect(dialog).toHaveCount(0);
    await expect(en).toHaveValue(capturedGuidance.en);
    expect(state.guidanceWrites.at(-1)).toEqual(capturedGuidance);
    expect(state.queueReads).toBe(beforeGuidanceSave);
    await expect(reason).toHaveValue('Independent postal issue draft');
    const shipment = page.getByRole('group', { name: copy('postalShipment'), exact: true });
    await inspectForm(
      page,
      guidance.or(shipment),
      `[aria-label="${copy('postalGuidance')}"], [aria-label="${copy('postalShipment')}"]`
    );
    if (locale === 'fa' && info.project.name === 'mobile-safari')
      await guidance.screenshot({ path: info.outputPath('solar-postal-staff-fa-dark.png') });

    const incomplete = page.getByRole('button', {
      name: copy('postal_mark-incomplete'),
      exact: true,
    });
    await reason.fill('ر'.repeat(1001));
    await incomplete.click();
    await focusedError(reason);
    expect(state.postalPreviews).toEqual([]);
    await reason.fill('ر'.repeat(1000));
    await incomplete.click();
    await focusedError(reason);
    await expect(reason).toHaveValue('ر'.repeat(1000));
    expect(state.postalPreviews).toEqual([{ decision: 'incomplete', reason: 'ر'.repeat(1000) }]);
    expect(state.postalWrites).toEqual([]);
    state.postalPreviewMode = 'success';
    await incomplete.click();
    dialog = page.getByRole('dialog', { name: copy('postal_mark-incomplete'), exact: true });
    const capturedIssue = { reason: 'ر'.repeat(1000), expectedReviewHash: 'a'.repeat(64) };
    await dialog.locator('button[type=submit]').click();
    await dialog.locator('input[type=password]').fill('synthetic-password');
    const beforeIssue = state.queueReads;
    await dialog.locator('button[type=submit]').click();
    await expect.poll(() => !!state.stepUp).toBe(true);
    await expect(dialog.locator('button[type=submit]')).toBeDisabled();
    await dialog.locator('form').dispatchEvent('submit');
    expect(state.verifications).toBe(1);
    expect(state.postalWrites).toEqual([capturedIssue]);
    state.verified = true;
    await state.stepUp!.fulfill({ json: { verified: true } });
    await expect(dialog).toHaveCount(0);
    expect(state.postalWrites).toEqual([capturedIssue, capturedIssue]);
    await expect.poll(() => state.queueReads).toBeGreaterThan(beforeIssue);
    await expect(en).toHaveValue(capturedGuidance.en);

    await page.getByRole('button', { name: /Older solar buyer/ }).click();
    const close = page.getByRole('button', { name: copy('solarCloseNoContract'), exact: true });
    await expect(reason).not.toHaveAttribute('aria-required', 'true');
    await close.click();
    await focusedError(reason);
    expect(state.finalPreviews).toEqual([]);
    await reason.fill('ف'.repeat(1001));
    await close.click();
    await focusedError(reason);
    expect(state.finalPreviews).toEqual([]);
    await reason.fill('ف'.repeat(1000));
    await close.click();
    await expect.poll(() => !!state.finalPreview).toBe(true);
    await page.getByRole('button', { name: /First solar buyer/ }).click();
    await expect(close).toHaveCount(0);
    await state.finalPreview!.fulfill({ json: finalReview(state.finalPreviews.at(-1)!) });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(state.finalWrites).toEqual([]);
    await page.getByRole('button', { name: /Older solar buyer/ }).click();
    await reason.fill('ف'.repeat(1000));
    state.finalPreviewMode = 'success';
    await close.click();
    dialog = page.getByRole('dialog', { name: copy('solarCloseNoContract'), exact: true });
    await approveRiskConfirmation(page, locale, 'destructive');
    await dialog.locator('button[type=submit]').click();
    await expect(dialog).toHaveCount(0);
    expect(state.finalPreviews.at(-1)).toEqual({
      decision: 'close-no-contract',
      reason: 'ف'.repeat(1000),
    });
    expect(state.finalWrites).toEqual([
      { reason: 'ف'.repeat(1000), expectedReviewHash: 'b'.repeat(64) },
    ]);
    await expect(page.getByRole('button', { name: /Older solar buyer/ })).toHaveCount(0);
    expect(state.finalClosed).toBe(true);
    await expect(en).toHaveValue(capturedGuidance.en);
  });

  test(`solar postal closing reason is required when it is the only decision (${locale}, ${theme})`, async ({
    page,
  }) => {
    const { state } = await setupSolarPostalForms(page, locale, theme === 'dark');
    state.finalStatus = 'approved';
    await page.goto('/admin/solar-postal');
    await page.getByRole('button', { name: /Older solar buyer/ }).click();
    const reason = page.locator('#solar-postal-reason');
    await expect(reason).toHaveAttribute('aria-required', 'true');
    await expect(
      page.getByRole('button', { name: copy('solarFinalApprove'), exact: true })
    ).toHaveCount(0);
    await page.getByRole('button', { name: copy('solarCloseNoContract'), exact: true }).click();
    await focusedError(reason);
    expect(state.finalPreviews).toEqual([]);
    expect(state.finalWrites).toEqual([]);
  });
}
